'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Expose des APIs sûres au renderer (contextIsolation = true)
contextBridge.exposeInMainWorld('electronAPI', {
    isElectron:  true,
    pickDiskDir:    ()           => ipcRenderer.invoke('pick-disk-dir'),
    restoreDiskDir: (path)       => ipcRenderer.invoke('restore-disk-dir', path),
    readDisk:    (name)       => ipcRenderer.invoke('read-disk', name),
    writeDisk:   (name, data) => ipcRenderer.invoke('write-disk', name, data),
    openExternal: (url)       => ipcRenderer.invoke('open-external', url),
    zoom:         (delta)     => ipcRenderer.invoke('zoom', delta),
    clipboardRead:    ()       => ipcRenderer.invoke('clipboard-read'),
    serialReadFile:   ()       => ipcRenderer.invoke('serial-read-file'),
    serialSaveFile:   (data)   => ipcRenderer.invoke('serial-save-file', data),
});
