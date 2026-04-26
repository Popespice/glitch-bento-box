import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bento', {
  // System stats
  platform:       () => ipcRenderer.invoke('sys:platform'),
  cpu:            () => ipcRenderer.invoke('sys:cpu'),
  gpu:            () => ipcRenderer.invoke('sys:gpu'),
  memory:         () => ipcRenderer.invoke('sys:memory'),
  network:        () => ipcRenderer.invoke('sys:network'),
  battery:        () => ipcRenderer.invoke('sys:battery'),
  githubHeatmap:  () => ipcRenderer.invoke('sys:github-heatmap'),
  weather:        () => ipcRenderer.invoke('sys:weather'),
  lastCommand:    () => ipcRenderer.invoke('sys:last-command'),
  uptime:         () => ipcRenderer.invoke('sys:uptime'),
  disk:           () => ipcRenderer.invoke('sys:disk'),
  playSound:      (sound) => ipcRenderer.invoke('sys:play-sound', sound),
  nowPlaying:     () => ipcRenderer.invoke('sys:now-playing'),

  // Spotify OAuth
  spotifyConnect:    () => ipcRenderer.invoke('spotify:connect'),
  spotifyDisconnect: () => ipcRenderer.invoke('spotify:disconnect'),

  // Settings
  settingsGet:     ()          => ipcRenderer.invoke('settings:get'),
  settingsSet:     (key, val)  => ipcRenderer.invoke('settings:set', key, val),
  settingsGeocode: (query)     => ipcRenderer.invoke('settings:geocode', query),

  // Window controls (Mac custom traffic lights)
  windowClose:    () => ipcRenderer.send('win:close'),
  windowMinimize: () => ipcRenderer.send('win:minimize'),
  windowMaximize: () => ipcRenderer.send('win:maximize'),
})
