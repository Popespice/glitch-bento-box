import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bento', {
  platform: () => ipcRenderer.invoke('sys:platform'),
  cpu: () => ipcRenderer.invoke('sys:cpu'),
  memory: () => ipcRenderer.invoke('sys:memory'),
  network: () => ipcRenderer.invoke('sys:network'),
  battery: () => ipcRenderer.invoke('sys:battery'),
})
