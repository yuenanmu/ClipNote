import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../contracts/desktop.ts';
const api: DesktopApi = { importSource: (...args: unknown[]) => ipcRenderer.invoke('source:import', ...args) };
contextBridge.exposeInMainWorld('clipnote', api);
