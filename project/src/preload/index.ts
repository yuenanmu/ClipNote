import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../contracts/desktop.ts';
const api: DesktopApi = {
  importSource: (...args: unknown[]) => ipcRenderer.invoke('source:import', ...args),
  libraryState: (...args: unknown[]) => ipcRenderer.invoke('storage:state', ...args),
  chooseLibrary: (...args: unknown[]) => ipcRenderer.invoke('storage:choose', ...args),
  saveSource: (...args: unknown[]) => ipcRenderer.invoke('storage:save', ...args),
  resumeSave: (...args: unknown[]) => ipcRenderer.invoke('storage:resume', ...args),
  openRevision: (...args: unknown[]) => ipcRenderer.invoke('storage:open', ...args),
};
contextBridge.exposeInMainWorld('clipnote', api);
