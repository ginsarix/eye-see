"""Converts OpenAI's CLIP ViT-B/32 into the compiled Core ML models Eye See bundles.

Run it through `pnpm models`, which sets up the Python environment. Converting
from the PyTorch weights with coremltools keeps the weights in weight.bin, so
Core ML loads the models in well under a second. See
docs/superpowers/spikes/2026-09-29-native-coreml/NOTES.md for the alternatives
that were measured.
"""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import coremltools as ct
import numpy as np
import torch
from transformers import CLIPTextModelWithProjection, CLIPVisionModelWithProjection

MODEL_ID = "openai/clip-vit-base-patch32"
# Must match BATCH_SIZE in src-tauri/src/clip/mod.rs and src/lib/engine.ts
BATCH_SIZE = 32
# CLIP's text context; must match CONTEXT_LENGTH in src-tauri/src/clip/tokenize.rs
CONTEXT_LENGTH = 77
START_OF_TEXT = 49406
END_OF_TEXT = 49407
OUT_DIR = Path(__file__).resolve().parent.parent / "src-tauri/resources/models"
# fp32 by default: text runs once per search, so its precision costs little
TEXT_PRECISION = os.environ.get("TEXT_PRECISION", "fp32")


class Vision(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.model = CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, attn_implementation="eager").eval()

    def forward(self, pixel_values):
        return self.model(pixel_values=pixel_values).image_embeds


class Text(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.model = CLIPTextModelWithProjection.from_pretrained(MODEL_ID, attn_implementation="eager").eval()

    def forward(self, input_ids):
        return self.model(input_ids=input_ids).text_embeds


def convert(module, example, input_type, output_name, precision):
    with torch.no_grad():
        traced = torch.jit.trace(module.eval(), example)
    # Fixed input shapes: with flexible ones the GPU runtime rejects the model
    # and most of it falls back to the CPU
    return ct.convert(
        traced,
        inputs=[input_type],
        outputs=[ct.TensorType(name=output_name)],
        convert_to="mlprogram",
        compute_precision=precision,
        minimum_deployment_target=ct.target.macOS14,
    )


def compile_into(mlmodel, name):
    with tempfile.TemporaryDirectory() as tmp:
        package = Path(tmp) / f"{name}.mlpackage"
        mlmodel.save(str(package))
        subprocess.run(["xcrun", "coremlcompiler", "compile", str(package), tmp], check=True)
        target = OUT_DIR / f"{name}.mlmodelc"
        shutil.rmtree(target, ignore_errors=True)
        shutil.move(str(Path(tmp) / f"{name}.mlmodelc"), target)
    print(f"Wrote {target}")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    vision = convert(
        Vision(),
        torch.rand(BATCH_SIZE, 3, 224, 224),
        ct.TensorType(name="pixel_values", shape=(BATCH_SIZE, 3, 224, 224)),
        "image_embeds",
        ct.precision.FLOAT16,
    )
    compile_into(vision, "clip_vision")

    # CLIP pools the first end-of-text token and its attention is causal, so
    # padding the ids with end-of-text after it doesn't change the embedding
    example_ids = torch.full((1, CONTEXT_LENGTH), END_OF_TEXT, dtype=torch.int64)
    example_ids[0, 0] = START_OF_TEXT
    text = convert(
        Text(),
        example_ids,
        ct.TensorType(name="input_ids", shape=(1, CONTEXT_LENGTH), dtype=np.int32),
        "text_embeds",
        ct.precision.FLOAT16 if TEXT_PRECISION == "fp16" else ct.precision.FLOAT32,
    )
    compile_into(text, "clip_text")


if __name__ == "__main__":
    main()
