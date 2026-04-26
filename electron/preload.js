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

  // Calendar (CalDAV: iCloud + Google)
  calendarStatus:        ()      => ipcRenderer.invoke('calendar:status'),
  calendarConnectIcloud: (u, p)  => ipcRenderer.invoke('calendar:connect-icloud', u, p),
  calendarConnectGoogle: ()      => ipcRenderer.invoke('calendar:connect-google'),
  calendarGetCalendars:  ()      => ipcRenderer.invoke('calendar:get-calendars'),
  calendarSetActive:     (ids)   => ipcRenderer.invoke('calendar:set-active-calendars', ids),
  calendarDisconnect:    ()      => ipcRenderer.invoke('calendar:disconnect'),
  calendarNextEvent:     ()      => ipcRenderer.invoke('sys:calendar-next-event'),

  // Quick settings — WiFi, Bluetooth, Caffeinate, Focus
  wifiStatus:        ()      => ipcRenderer.invoke('sys:wifi-status'),
  wifiToggle:        (on)    => ipcRenderer.invoke('sys:wifi-toggle', on),
  bluetoothStatus:   ()      => ipcRenderer.invoke('sys:bluetooth-status'),
  bluetoothToggle:   (on)    => ipcRenderer.invoke('sys:bluetooth-toggle', on),
  caffeinateStatus:  ()      => ipcRenderer.invoke('sys:caffeinate-status'),
  caffeinateToggle:  (on)    => ipcRenderer.invoke('sys:caffeinate-toggle', on),
  focusSet:          (name)  => ipcRenderer.invoke('sys:focus-set', name),
  openShortcutsApp:  ()      => ipcRenderer.invoke('sys:open-shortcuts'),

  // Settings
  settingsGet:     ()          => ipcRenderer.invoke('settings:get'),
  settingsSet:     (key, val)  => ipcRenderer.invoke('settings:set', key, val),
  settingsGeocode: (query)     => ipcRenderer.invoke('settings:geocode', query),

  // Window controls (Mac custom traffic lights)
  windowClose:    () => ipcRenderer.send('win:close'),
  windowMinimize: () => ipcRenderer.send('win:minimize'),
  windowMaximize: () => ipcRenderer.send('win:maximize'),
})
