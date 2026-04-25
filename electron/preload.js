import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bento', {
  // System stats
  platform:       () => ipcRenderer.invoke('sys:platform'),
  cpu:            () => ipcRenderer.invoke('sys:cpu'),
  memory:         () => ipcRenderer.invoke('sys:memory'),
  network:        () => ipcRenderer.invoke('sys:network'),
  battery:        () => ipcRenderer.invoke('sys:battery'),
  githubHeatmap:  () => ipcRenderer.invoke('sys:github-heatmap'),
  weather:        () => ipcRenderer.invoke('sys:weather'),

  // Settings
  settingsGet:     ()          => ipcRenderer.invoke('settings:get'),
  settingsSet:     (key, val)  => ipcRenderer.invoke('settings:set', key, val),
  settingsGeocode: (query)     => ipcRenderer.invoke('settings:geocode', query),

  // Window controls (Mac custom traffic lights)
  windowClose:    () => ipcRenderer.send('win:close'),
  windowMinimize: () => ipcRenderer.send('win:minimize'),
  windowMaximize: () => ipcRenderer.send('win:maximize'),
})
