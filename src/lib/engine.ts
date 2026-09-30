import { Channel, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// The vision model's batch size is fixed; must match BATCH_SIZE in
// src-tauri/src/clip/mod.rs
export const BATCH_SIZE = 32;

export interface SearchMatch {
  // Path relative to the searched directory, `/`-separated
  fileName: string;
  path: string;
  score: number;
}

export type SearchEvent =
  // Relative paths of every image being searched, in processing order
  | { kind: 'files'; files: string[] }
  // Sent after each batch
  | { kind: 'progress'; filesProcessed: number };

// Repeats the events' file list and count: channel messages and the command's
// response aren't guaranteed to arrive in order
export interface SearchOutcome {
  // The best matches, best first
  matches: SearchMatch[];
  files: string[];
  filesProcessed: number;
}

export type ModelState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

export interface BenchmarkOptions {
  // Absolute path of the image folder
  dir: string;
  query: string;
  // Image file name → the caption that should retrieve it
  captions: Record<string, string>;
  warmups: number;
  runs: number;
}

export interface RunTimings {
  listMs: number;
  // Decoding and preprocessing
  prepareMs: number;
  inferenceMs: number;
  totalMs: number;
}

export interface Accuracy {
  recallAt1: number;
  recallAt5: number;
  mrr: number;
}

export interface BenchmarkResult {
  // How long the engine took to load at startup, warm-up included
  loadMs: number;
  imageCount: number;
  // The measured runs, without the warm-ups
  runs: RunTimings[];
  median: RunTimings;
  imagesPerSecond: number;
  accuracy: Accuracy;
}

export function searchImages(
  dir: string,
  query: string,
  includeSubdirectories: boolean,
  onEvent: (event: SearchEvent) => void,
): Promise<SearchOutcome> {
  return invoke('search', { dir, query, includeSubdirectories, onEvent: new Channel(onEvent) });
}

export function getModelState(): Promise<ModelState> {
  return invoke('model_state');
}

export function onModelState(callback: (state: ModelState) => void): Promise<UnlistenFn> {
  return listen<ModelState>('model-state', (event) => callback(event.payload));
}

export function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkResult> {
  return invoke('benchmark_run', { options });
}
