import {
  AutoTokenizer,
  AutoProcessor,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  PreTrainedTokenizer,
  PreTrainedModel,
  Processor,
} from '@xenova/transformers';

const modelId = 'jinaai/jina-clip-v2';

export let model:
  | {
      tokenizer: PreTrainedTokenizer;
      textModel: PreTrainedModel;
      visionProcessor: Processor;
      visionModel: PreTrainedModel;
    }
  | undefined;

export async function loadModel() {
  model = {
    tokenizer: await AutoTokenizer.from_pretrained(modelId),
    textModel: await CLIPTextModelWithProjection.from_pretrained(modelId),
    visionProcessor: await AutoProcessor.from_pretrained(modelId),
    visionModel: await CLIPVisionModelWithProjection.from_pretrained(modelId),
  };
}
