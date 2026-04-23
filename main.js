'use strict'

const {
  app, BrowserWindow, ipcMain, shell,
  Tray, Menu, globalShortcut, nativeImage, Notification
} = require('electron')
const path    = require('path')
const fs      = require('fs')
const { spawn } = require('child_process')
const Store   = require('electron-store')
const AutoLaunch = require('electron-auto-launch')

const store = new Store()

let mainWindow    = null
let tray          = null
let pythonProcess = null
let isQuitting    = false

// アクティブセッション管理（マルチ計測）
let activeSessions = []
// リマインダータイマー管理 { session_id: TimerId }
let reminderTimers = {}

const autoLauncher = new AutoLaunch({ name: 'Ink Habit' })

// ── Python パス解決 ───────────────────────────────
function getPythonPath() {
  if (process.platform === 'win32') {
    const bases = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python'),
      path.join(process.env.PROGRAMFILES || '', 'Python')
    ]
    const versions = ['Python313', 'Python312', 'Python311', 'Python310', 'Python39']
    for (const base of bases)
      for (const ver of versions) {
        const p = path.join(base, ver, 'python.exe')
        if (fs.existsSync(p)) return p
      }
    return 'python'
  }
  return 'python3'
}

function getWorkerPath() {
  const dev = path.join(__dirname, 'python', 'worker.py')
  if (fs.existsSync(dev)) return dev
  return path.join(process.resourcesPath, 'python', 'worker.py')
}

// ── Python Worker ─────────────────────────────────
function startPython() {
  if (pythonProcess) return
  const workerPath = getWorkerPath()
  pythonProcess = spawn(getPythonPath(), [workerPath], {
    cwd: path.dirname(workerPath),
    env: { ...process.env, PYTHONUTF8: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  })

  let buf = ''
  pythonProcess.stdout.on('data', (data) => {
    buf += data.toString('utf8')
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        handlePythonMessage(obj)
      } catch (_) {}
    }
  })

  pythonProcess.stderr.on('data', (data) => {
    console.error('[Python]', data.toString())
  })

  pythonProcess.on('close', () => {
    pythonProcess = null
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('python-closed', {})
  })
}

function sendToPython(obj) {
  if (pythonProcess?.stdin?.writable)
    pythonProcess.stdin.write(JSON.stringify(obj) + '\n')
}

// ── Pythonメッセージ処理 ──────────────────────────
function handlePythonMessage(obj) {
  // セッション開始時にリマインダータイマーをセット
  if (obj.type === 'session-started') {
    activeSessions.push({
      id:         obj.id,
      name:       obj.name || '',
      category:   obj.category,
      started_at: obj.started_at
    })
    scheduleReminder(obj.id)
    updateTrayMenu()
  }

  // セッション停止時にタイマー解除
  if (obj.type === 'session-stopped') {
    activeSessions = activeSessions.filter(s => s.id !== obj.session_id)
    clearReminder(obj.session_id)
    updateTrayMenu()
  }

  // UIへ転送
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('python-message', obj)
}

// ── リマインダー ──────────────────────────────────
function scheduleReminder(sessionId) {
  clearReminder(sessionId)
  const config   = store.get('config', {})
  const minutes  = config.reminder_minutes || 60
  const ms       = minutes * 60 * 1000

  reminderTimers[sessionId] = setTimeout(() => {
    const session = activeSessions.find(s => s.id === sessionId)
    if (!session) return

    // デスクトップ通知
    fireReminder(session)

    // DBに記録
    sendToPython({ action: 'reminder-fired', session_id: sessionId })

    // 繰り返しスケジュール
    scheduleReminder(sessionId)
  }, ms)
}

function clearReminder(sessionId) {
  if (reminderTimers[sessionId]) {
    clearTimeout(reminderTimers[sessionId])
    delete reminderTimers[sessionId]
  }
}

function fireReminder(session) {
  const started  = new Date(session.started_at)
  const elapsed  = Math.floor((Date.now() - started.getTime()) / 60000)

  const notif = new Notification({
    title: '🦁 切り替えを忘れていませんか？',
    body:  `「${session.name}」を開始してから ${elapsed} 分が経過しています。`,
    silent: false
  })

  notif.on('click', () => {
    showWindow()
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('focus-input')
  })

  notif.show()

  // トレイバルーン（Windows）
  if (process.platform === 'win32' && tray) {
    tray.displayBalloon({
      title:   '🦁 Ink Habit — 切り替えを忘れていませんか？',
      content: `「${session.name}」を開始してから ${elapsed} 分が経過しています。`
    })
  }

  // UIにも通知
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('reminder-fired', { session_id: session.id, elapsed_min: elapsed })
}

// ── トレイ ────────────────────────────────────────
function getIconPath() {
  return path.join(__dirname, 'assets',
    process.platform === 'win32' ? 'icon.ico' : 'icon.png')
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(getIconPath()))
  tray.setToolTip('Ink Habit')
  updateTrayMenu()
  tray.on('double-click', showWindow)
}

function updateTrayMenu() {
  const sessionItems = activeSessions.length > 0
    ? activeSessions.map(s => ({
        label:   `● ${s.name}`,
        enabled: false
      }))
    : [{ label: '計測中のタスクなし', enabled: false }]

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ink Habit',  enabled: false },
    { type: 'separator' },
    ...sessionItems,
    { type: 'separator' },
    {
      label: '新しいタスクを開始',
      click: () => { showWindow(); mainWindow?.webContents.send('focus-input') }
    },
    {
      label: '今日のサマリー',
      click: () => { showWindow(); mainWindow?.webContents.send('show-tab', 'today') }
    },
    { type: 'separator' },
    { label: '終了', click: () => { isQuitting = true; app.quit() } }
  ]))
}

function showWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// ── ウィンドウ ────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:     1100,
    height:    780,
    minWidth:  860,
    minHeight: 600,
    backgroundColor: '#0d0d0f',
    titleBarStyle:   'hidden',
    frame:           false,
    icon:            getIconPath(),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false
    },
    show: false
  })

  mainWindow.loadFile('index.html')

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    startPython()
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow.hide()
      if (process.platform === 'win32' && tray) {
        tray.displayBalloon({
          title:   'Ink Habit',
          content: 'タスクトレイに格納しました。終了するにはトレイアイコンを右クリックしてください。'
        })
      }
    }
  })
}

// ── グローバルショートカット ──────────────────────
function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    showWindow()
    mainWindow?.webContents.send('focus-input')
  })
}

// ── 起動 ──────────────────────────────────────────
app.whenReady().then(() => {
  createWindow()
  createTray()
  registerShortcuts()
})

app.on('before-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  Object.keys(reminderTimers).forEach(clearReminder)
  if (pythonProcess) {
    sendToPython({ action: 'quit' })
    pythonProcess.kill()
  }
})

app.on('activate', showWindow)
app.on('window-all-closed', () => {})

// ── IPC ───────────────────────────────────────────

// ウィンドウ操作
ipcMain.handle('window-minimize', () => mainWindow?.minimize())
ipcMain.handle('window-maximize', () =>
  mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
)
ipcMain.handle('window-close',    () => mainWindow?.hide())

// スタートアップ
ipcMain.handle('get-auto-launch', async () => {
  try { return await autoLauncher.isEnabled() } catch (_) { return false }
})
ipcMain.handle('set-auto-launch', async (_, on) => {
  try {
    on ? await autoLauncher.enable() : await autoLauncher.disable()
    return true
  } catch (_) { return false }
})

// 外部リンク
ipcMain.handle('open-external', (_, url) => shell.openExternal(url))

// Python転送
ipcMain.handle('session-start',      (_, p) => { sendToPython({ action: 'session-start',      ...p }); return true })
ipcMain.handle('session-stop',       (_, p) => { sendToPython({ action: 'session-stop',       ...p }); return true })
ipcMain.handle('session-active',     ()     => { sendToPython({ action: 'session-active' });            return true })
ipcMain.handle('session-concurrent', (_, p) => { sendToPython({ action: 'session-concurrent', ...p }); return true })
ipcMain.handle('db-query',           (_, p) => { sendToPython({ action: 'db-query',           ...p }); return true })
ipcMain.handle('db-update',          (_, p) => { sendToPython({ action: 'db-update',          ...p }); return true })
ipcMain.handle('session-add-past',        (_, p) => { sendToPython({ action: 'session-add-past',        ...p }); return true })
ipcMain.handle('session-update-category', (_, p) => { sendToPython({ action: 'session-update-category', ...p }); return true })
ipcMain.handle('session-edit',            (_, p) => { sendToPython({ action: 'session-edit',            ...p }); return true })
ipcMain.handle('session-delete',          (_, p) => { sendToPython({ action: 'session-delete',          ...p }); return true })
ipcMain.handle('get-suggestions',    ()     => { sendToPython({ action: 'get-suggestions' });           return true })
ipcMain.handle('lion-eye',           (_, p) => { sendToPython({ action: 'lion-eye',           ...p }); return true })
ipcMain.handle('get-ollama-models',  ()     => { sendToPython({ action: 'get-ollama-models' });         return true })
ipcMain.handle('get-config',         ()     => { sendToPython({ action: 'get-config' });                return true })
ipcMain.handle('save-config',        (_, d) => {
  store.set('config', d)
  sendToPython({ action: 'save-config', data: d })
  return true
})

// アクティブセッション一覧（メモリから即返す）
ipcMain.handle('get-active-sessions', () => activeSessions)
