import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  openDirectory: () => Promise<string | null>;
  readDirectory: (directoryPath: string) => Promise<{ name: string; path: string; isFile: boolean }[]>;
  readFile: (filePath: string) => Promise<ArrayBuffer>;
}

const electronAPI: ElectronAPI = {
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  readDirectory: (directoryPath: string) => ipcRenderer.invoke('fs:readDirectory', directoryPath),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
