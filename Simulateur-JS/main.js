'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs   = require('fs');

let mainWindow;
let diskDir    = null;   // chemin du dossier disques sélectionné
let zoomFactor = 1.0;

// ─── Fenêtre principale ───────────────────────────────────────────
function createWindow() {
    mainWindow = new BrowserWindow({
        width:  960,
        height: 860,
        minWidth:  800,
        minHeight: 700,
        webPreferences: {
            preload:          path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration:  false,
        },
        title:           'Smaky 6 Simulator',
        autoHideMenuBar: true,
        icon:            path.join(__dirname, 'icon.ico'),
    });
    mainWindow.loadFile('index.html');
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.setTitle('SimSmaky6 : simulateur de Smaky 6. Version ' + app.getVersion());
    });

    // Bloquer la touche Meta (Windows) pour éviter que le menu Démarrer
    // s'ouvre quand on relâche la touche Kill du Smaky.
    // Ctrl+Plus/Minus/0 : zoom de la fenêtre.
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'Meta') { event.preventDefault(); return; }
        if (input.control && input.type === 'keyDown') {
            if (input.key === '=' || input.key === '+') {
                zoomFactor = Math.min(3.0, +(zoomFactor + 0.1).toFixed(1));
                mainWindow.webContents.setZoomFactor(zoomFactor);
                event.preventDefault();
            } else if (input.key === '-') {
                zoomFactor = Math.max(0.5, +(zoomFactor - 0.1).toFixed(1));
                mainWindow.webContents.setZoomFactor(zoomFactor);
                event.preventDefault();
            } else if (input.key === '0') {
                zoomFactor = 1.0;
                mainWindow.webContents.setZoomFactor(zoomFactor);
                event.preventDefault();
            }
        }
    });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── IPC : sélection du dossier disques ──────────────────────────
ipcMain.handle('pick-disk-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title:       'Dossier des images disque (SM6WIN*.DSK)',
        properties:  ['openDirectory'],
        buttonLabel: 'Sélectionner',
    });
    if (result.canceled || !result.filePaths.length) return null;
    diskDir = result.filePaths[0];
    // Lister les images présentes
    const found = fs.readdirSync(diskDir)
        .filter(f => /^SM6WIN[0-9]\.DSK$/i.test(f))
        .map(f => f.toUpperCase())
        .sort();
    return { dir: diskDir, disks: found };
});

// ─── IPC : restauration du dossier disques (depuis localStorage) ─
ipcMain.handle('restore-disk-dir', (event, savedPath) => {
    if (!savedPath || !fs.existsSync(savedPath)) return null;
    diskDir = savedPath;
    const found = fs.readdirSync(diskDir)
        .filter(f => /^SM6WIN[0-9]\.DSK$/i.test(f))
        .map(f => f.toUpperCase())
        .sort();
    return { dir: diskDir, disks: found };
});

// ─── IPC : lecture d'une image disque ────────────────────────────
ipcMain.handle('read-disk', (event, name) => {
    if (!diskDir) return null;
    const p = path.join(diskDir, name);
    if (!fs.existsSync(p)) return null;
    // Retourne un Buffer → IPC le sérialise en Uint8Array côté renderer
    return fs.readFileSync(p);
});

// ─── IPC : zoom ──────────────────────────────────────────────────
ipcMain.handle('zoom', (event, delta) => {
    zoomFactor = Math.min(3.0, Math.max(0.5, +(zoomFactor + delta).toFixed(1)));
    mainWindow.webContents.setZoomFactor(zoomFactor);
});

// ─── IPC : lecture du presse-papiers ─────────────────────────────
ipcMain.handle('clipboard-read', () => clipboard.readText());

// ─── IPC : série — lire un fichier (PR) ──────────────────────────
ipcMain.handle('serial-read-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Fichier source pour le lecteur de ruban (#PR)',
        buttonLabel: 'Ouvrir',
    });
    if (result.canceled || !result.filePaths.length) return null;
    const p = result.filePaths[0];
    const data = fs.readFileSync(p);
    return { name: require('path').basename(p), data: new Uint8Array(data) };
});

// ─── IPC : série — sauvegarder un fichier (PP) ───────────────────
ipcMain.handle('serial-save-file', async (event, data) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Enregistrer la sortie du perforateur de ruban (#PP)',
        buttonLabel: 'Enregistrer',
    });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, Buffer.from(data));
    return true;
});

// ─── IPC : ouvrir un lien dans le navigateur système ─────────────
ipcMain.handle('open-external', (event, url) => {
    shell.openExternal(url);
});

// ─── IPC : écriture d'une image disque ───────────────────────────
ipcMain.handle('write-disk', (event, name, data) => {
    if (!diskDir) return false;
    const p = path.join(diskDir, name);
    try {
        fs.writeFileSync(p, Buffer.from(data));
        return true;
    } catch (e) {
        console.error('write-disk', name, e.message);
        return false;
    }
});
