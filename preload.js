'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('inkHabit', {

  // ── ウィンドウ操作 ──
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close:    () => ipcRenderer.invoke('window-close'),

  // ── スタートアップ ──
  getAutoLaunch: ()       => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enable) => ipcRenderer.invoke('set-auto-launch', enable),

  // ── 外部リンク ──
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // ── セッション操作（マルチ計測） ──
  sessionStart:      (payload) => ipcRenderer.invoke('session-start',      payload),
  sessionStop:       (payload) => ipcRenderer.invoke('session-stop',       payload),
  sessionActive:     ()        => ipcRenderer.invoke('session-active'),
  sessionConcurrent: (payload) => ipcRenderer.invoke('session-concurrent', payload),
  getActiveSessions: ()        => ipcRenderer.invoke('get-active-sessions'),

  // ── DB操作 ──
  dbQuery:  (payload) => ipcRenderer.invoke('db-query',  payload),
  dbUpdate: (payload) => ipcRenderer.invoke('db-update', payload),

  // ── 過去セッション追加・カテゴリ更新 ──
  sessionAddPast:        (payload) => ipcRenderer.invoke('session-add-past',        payload),
  sessionUpdateCategory: (payload) => ipcRenderer.invoke('session-update-category', payload),

  // ── サジェスト ──
  getSuggestions: () => ipcRenderer.invoke('get-suggestions'),

  // ── LION EYE ──
  lionEye: (payload) => ipcRenderer.invoke('lion-eye', payload),

  // ── Ollama ──
  getOllamaModels: () => ipcRenderer.invoke('get-ollama-models'),

  // ── 設定 ──
  getConfig:  ()     => ipcRenderer.invoke('get-config'),
  saveConfig: (data) => ipcRenderer.invoke('save-config', data),

  // ── Pythonからのメッセージ受信 ──
  onPythonMessage: (cb) => ipcRenderer.on('python-message', (_, d) => cb(d)),
  onPythonClosed:  (cb) => ipcRenderer.on('python-closed',  (_, d) => cb(d)),

  // ── メインからのUI指示 ──
  onFocusInput:    (cb) => ipcRenderer.on('focus-input',    ()     => cb()),
  onShowTab:       (cb) => ipcRenderer.on('show-tab',       (_, t) => cb(t)),
  onReminderFired: (cb) => ipcRenderer.on('reminder-fired', (_, d) => cb(d)),

  // ── リスナー解除 ──
  removeAllListeners: (ch) => ipcRenderer.removeAllListeners(ch)
})
