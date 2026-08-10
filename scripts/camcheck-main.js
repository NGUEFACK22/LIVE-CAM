// Mini app Electron de test : charge camcheck.html et log les cameras.
const { app, BrowserWindow } = require('electron')
const path = require('path')

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 800,
    height: 700,
    title: 'Cam Check',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  win.loadFile(path.join(__dirname, 'camcheck.html'))
  win.webContents.on('console-message', (e, level, message) => {
    console.log('[page]', message)
  })
  win.webContents.on('did-finish-load', () => {
    // Capture le contenu du DOM apres l'enumeration
    setTimeout(() => {
      win.webContents.executeJavaScript('document.getElementById("list").innerText').then((txt) => {
        console.log('=== RESULTAT ENUMERATION ===')
        console.log(txt)
        app.exit(0)
      })
    }, 4000)
  })
})
