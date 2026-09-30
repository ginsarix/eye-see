// Shared by the runner and the WebdriverIO spec. Node runs these files directly,
// so they may only import types from src/.

export const QUERY = 'a dog running on the beach';
export const WARMUPS = 1;
export const RUNS = 3;
// Must match the number of photos in benchmark/images
export const IMAGE_COUNT = 128;
