import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export interface DirEntry {
  name: string;
  path: string;
  isFile: boolean;
  isSymlink: boolean;
}

export async function openDirectory(): Promise<string | null> {
  return open({ directory: true, multiple: false });
}

export function readDirectory(directoryPath: string): Promise<DirEntry[]> {
  return invoke('read_directory', { directoryPath });
}

export function readFile(filePath: string): Promise<ArrayBuffer> {
  return invoke('read_file', { filePath });
}
