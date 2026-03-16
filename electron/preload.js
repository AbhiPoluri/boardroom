// Preload script — contextIsolation bridge
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('boardroom', {
  version: process.env.npm_package_version || '0.1.0',
  platform: process.platform,
});
