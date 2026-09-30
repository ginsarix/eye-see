import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export async function openDirectory(): Promise<string | null> {
  return open({ directory: true, multiple: false });
}

export function readFile(filePath: string): Promise<ArrayBuffer> {
  return invoke('read_file', { filePath });
}
