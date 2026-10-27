import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../contracts/desktop.ts';
const api: DesktopApi = {
  importSource: (...args: unknown[]) => ipcRenderer.invoke('source:import', ...args),
  libraryState: (...args: unknown[]) => ipcRenderer.invoke('storage:state', ...args),
  chooseLibrary: (...args: unknown[]) => ipcRenderer.invoke('storage:choose', ...args),
  saveSource: (...args: unknown[]) => ipcRenderer.invoke('storage:save', ...args),
  resumeSave: (...args: unknown[]) => ipcRenderer.invoke('storage:resume', ...args),
  openRevision: (...args: unknown[]) => ipcRenderer.invoke('storage:open', ...args),
  readerOpen: (...args: unknown[]) => ipcRenderer.invoke('reader:open', ...args),
  readerRevision: (...args: unknown[]) => ipcRenderer.invoke('reader:revision', ...args),
  readerRefresh: (...args: unknown[]) => ipcRenderer.invoke('reader:refresh', ...args),
  readerExternal: (...args: unknown[]) => ipcRenderer.invoke('reader:external', ...args),
  readerLink: (...args: unknown[]) => ipcRenderer.invoke('reader:link', ...args),
};
contextBridge.exposeInMainWorld('clipnote', api);
