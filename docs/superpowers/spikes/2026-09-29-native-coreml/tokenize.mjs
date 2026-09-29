// Tokenizes the benchmark captions with the same tokenizer the app uses, one
// caption at a time (unpadded, like a search query), for the Rust spike.
import { readFileSync, writeFileSync } from 'node:fs';
import { AutoTokenizer } from '/Users/cankomusdogan/Projects/eye-see/node_modules/@huggingface/transformers/dist/transformers.node.mjs';

const captions = JSON.parse(
  readFileSync('/Users/cankomusdogan/Projects/eye-see/benchmark/images/captions.json', 'utf8'),
);
const tokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-base-patch32');

const out = Object.entries(captions).map(([file, caption]) => {
  const { input_ids } = tokenizer([caption], { padding: true, truncation: true });
  return { file, ids: Array.from(input_ids.data, Number) };
});
writeFileSync(new URL('./tokens.json', import.meta.url), JSON.stringify(out));
console.log(`${out.length} captions, ${Math.min(...out.map((o) => o.ids.length))}–${Math.max(...out.map((o) => o.ids.length))} tokens`);
