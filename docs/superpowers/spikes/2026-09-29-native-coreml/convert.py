# Converts OpenAI's CLIP ViT-B/32 vision tower to Core ML with coremltools,
# so weights land in weight.bin (fast to load) instead of inline in model.mil.
import os

import coremltools as ct
import torch
from transformers import CLIPVisionModelWithProjection

# FIXED_BATCH=32 converts a single fixed shape instead of enumerated batch sizes
FIXED = os.environ.get("FIXED_BATCH")
BATCHES = [1, 8, 32]


class Vision(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.model = CLIPVisionModelWithProjection.from_pretrained(
            "openai/clip-vit-base-patch32", attn_implementation="eager"
        ).eval()

    def forward(self, pixel_values):
        return self.model(pixel_values=pixel_values).image_embeds


with torch.no_grad():
    traced = torch.jit.trace(Vision().eval(), torch.rand(8, 3, 224, 224))

mlmodel = ct.convert(
    traced,
    inputs=[
        ct.TensorType(
            name="pixel_values",
            shape=[int(FIXED), 3, 224, 224]
            if FIXED
            else ct.EnumeratedShapes(shapes=[[b, 3, 224, 224] for b in BATCHES], default=[8, 3, 224, 224]),
        )
    ],
    outputs=[ct.TensorType(name="image_embeds")],
    convert_to="mlprogram",
    compute_precision=ct.precision.FLOAT16,
    minimum_deployment_target=ct.target.macOS14,
)
name = f"clip_vision_b{FIXED}.mlpackage" if FIXED else "clip_vision.mlpackage"
mlmodel.save(name)
print(f"saved {name}")
