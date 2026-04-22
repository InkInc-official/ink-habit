'use strict'

// ── 定数 ─────────────────────────────────────────
const CAT_COLORS = {
  '配信':    'var(--ink2)',
  '制作':    'var(--ink1)',
  '事務':    'var(--ink3)',
  'リサーチ': 'var(--ink4)',
  '休憩':    '#888',
  'その他':  '#555'
}

const INC_HP = 'https://inkinc-hp.vercel.app/'

// ── 状態 ─────────────────────────────────────────
let activeSessions   = []   // { id, name, category, started_at, estimated_sec }
let reminderCount    = 0
let timerIntervalId  = null

// ── ユーティリティ ────────────────────────────────
function fmtSec(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function fmtSecShort(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtTimer(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0')
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0')
  const s = String(sec % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

function fmtTime(isoStr) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function elapsedSec(startedAt) {
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
}

// ── タブ切り替え ──────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'))
  document.querySelectorAll('.tab, .nav-item[data-tab]').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabName)
  })
  const content = document.getElementById(`tab-${tabName}`)
  if (content) content.classList.add('active')

  if (tabName === 'today') loadTodaySessions()
  if (tabName === 'log')   loadAllSessions()
}

document.querySelectorAll('[data-tab]').forEach(el => {
  el.addEventListener('click', () => switchTab(el.dataset.tab))
})

// ── タイトルバー ──────────────────────────────────
document.getElementById('btn-close').addEventListener('click', () => window.inkHabit.close())
document.getElementById('btn-min').addEventListener('click',   () => window.inkHabit.minimize())
document.getElementById('btn-max').addEventListener('click',   () => window.inkHabit.maximize())
document.getElementById('btn-quit').addEventListener('click',  () => window.inkHabit.close())

// ── Ink Inc.リンク ────────────────────────────────
document.getElementById('ink-brand-link').addEventListener('click', () => {
  window.inkHabit.openExternal(INC_HP)
})

// ── サジェスト読み込み ────────────────────────────
function loadSuggestions() {
  window.inkHabit.getSuggestions()
}

function renderSuggestions(items) {
  const row = document.getElementById('suggest-row')
  row.innerHTML = ''
  items.forEach(name => {
    const chip = document.createElement('div')
    chip.className = 'chip'
    chip.textContent = name
    chip.addEventListener('click', () => {
      document.getElementById('task-input').value = name
      document.getElementById('task-input').focus()
    })
    row.appendChild(chip)
  })
}

// ── セッション開始 ────────────────────────────────
document.getElementById('btn-start').addEventListener('click', startTask)
document.getElementById('task-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') startTask()
})

function startTask() {
  const name = document.getElementById('task-input').value.trim()
  if (!name) {
    document.getElementById('task-input').focus()
    return
  }
  const estMin = parseInt(document.getElementById('est-input').value) || null
  const estimatedSec = estMin ? estMin * 60 : null

  window.inkHabit.sessionStart({ name, estimated_sec: estimatedSec })

  document.getElementById('task-input').value = ''
  document.getElementById('est-input').value  = ''
}

// ── セッション停止 ────────────────────────────────
function stopSession(sessionId) {
  window.inkHabit.sessionStop({ session_id: sessionId })
}

// ── アクティブセッション描画 ──────────────────────
function renderActiveSessions() {
  const container = document.getElementById('active-sessions')
  container.innerHTML = ''

  if (activeSessions.length === 0) {
    startTimerLoop(false)
    return
  }

  activeSessions.forEach(session => {
    const card = document.createElement('div')
    card.className = 'rec-card'
    card.dataset.sessionId = session.id

    const elapsed = elapsedSec(session.started_at)
    const estHtml = session.estimated_sec
      ? `<div class="rec-est">目標: <span>${session.estimated_sec / 60}分</span></div>`
      : ''

    card.innerHTML = `
      <div class="rec-header"><div class="pulse"></div>REC</div>
      <div class="rec-name">${escHtml(session.name)}</div>
      <div class="rec-timer" data-started="${session.started_at}">${fmtTimer(elapsed)}</div>
      <div class="rec-meta">${session.category}</div>
      ${estHtml}
      <button class="btn-stop" data-id="${session.id}">■ 停止する</button>
    `
    container.appendChild(card)
  })

  // 停止ボタン
  container.querySelectorAll('.btn-stop').forEach(btn => {
    btn.addEventListener('click', () => stopSession(parseInt(btn.dataset.id)))
  })

  startTimerLoop(true)
}

// ── タイマーループ ────────────────────────────────
function startTimerLoop(on) {
  if (timerIntervalId) { clearInterval(timerIntervalId); timerIntervalId = null }
  if (!on) return
  timerIntervalId = setInterval(() => {
    document.querySelectorAll('.rec-timer[data-started]').forEach(el => {
      const elapsed = elapsedSec(el.dataset.started)
      el.textContent = fmtTimer(elapsed)
    })
  }, 1000)
}

// ── 今日のセッション読み込み ──────────────────────
function loadTodaySessions() {
  const today = todayISO()
  window.inkHabit.dbQuery({
    table: 'sessions',
    order: 'started_at DESC'
  })
}

function renderTodaySessions(allRows) {
  const today = todayISO()
  const rows  = allRows.filter(r => r.started_at && r.started_at.startsWith(today) && r.ended_at)

  // 日付
  document.getElementById('today-date').textContent =
    new Date().toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })

  // サマリー
  const totalSec  = rows.reduce((a, r) => a + (r.duration_sec || 0), 0)
  const byCat     = {}
  rows.forEach(r => {
    byCat[r.category] = (byCat[r.category] || 0) + (r.duration_sec || 0)
  })
  const topCat = Object.entries(byCat).sort((a,b) => b[1]-a[1])[0]?.[0] || '—'

  document.getElementById('stat-total').innerHTML =
    totalSec > 0 ? `${Math.floor(totalSec/3600)}<small>h</small>${Math.floor((totalSec%3600)/60)}<small>m</small>` : '—'
  document.getElementById('stat-count').innerHTML =
    `${rows.length}<small>件</small>`
  document.getElementById('stat-remind').innerHTML =
    `${reminderCount}<small>回</small>`
  document.getElementById('stat-top-cat').textContent = topCat
  document.getElementById('log-count').textContent = `本日 ${rows.length}件`

  // カテゴリバー
  const catList = document.getElementById('cat-list')
  catList.innerHTML = ''
  if (Object.keys(byCat).length === 0) {
    catList.innerHTML = '<div class="empty">記録なし</div>'
  } else {
    const maxSec = Math.max(...Object.values(byCat))
    Object.entries(byCat).sort((a,b) => b[1]-a[1]).forEach(([cat, sec]) => {
      const pct   = Math.round((sec / maxSec) * 100)
      const color = CAT_COLORS[cat] || '#555'
      catList.innerHTML += `
        <div class="cat-row">
          <div class="cat-top">
            <span class="cat-name">${cat}</span>
            <span class="cat-time">${fmtSecShort(sec)}</span>
          </div>
          <div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
        </div>`
    })
  }

  // セッションログ
  const list = document.getElementById('today-session-list')
  list.innerHTML = ''
  if (rows.length === 0) {
    list.innerHTML = '<div class="empty">まだ記録がありません。<br>上の入力欄からタスクを開始してください。</div>'
    return
  }
  rows.forEach(r => {
    const color = CAT_COLORS[r.category] || '#555'
    const row   = document.createElement('div')
    row.className = 'session-row'
    row.innerHTML = `
      <div class="sdot" style="background:${color}"></div>
      <span class="sname">${escHtml(r.name)}</span>
      <span class="scat-edit" data-id="${r.id}" data-cat="${escHtml(r.category)}">${escHtml(r.category)}</span>
      <span class="sdur">${fmtSecShort(r.duration_sec || 0)}</span>
      <span class="stime">${fmtTime(r.started_at)}</span>
    `
    list.appendChild(row)
  })

  // カテゴリ編集イベント
  list.querySelectorAll('.scat-edit').forEach(el => {
    el.addEventListener('click', () => startCatEdit(el))
  })
}

// ── 全セッション読み込み ──────────────────────────
function loadAllSessions() {
  window.inkHabit.dbQuery({ table: 'sessions', order: 'started_at DESC', limit: 200 })
}

function renderAllSessions(rows) {
  const list = document.getElementById('all-session-list')
  document.getElementById('all-log-count').textContent = `${rows.length}件`
  list.innerHTML = ''
  if (rows.length === 0) {
    list.innerHTML = '<div class="empty">記録がありません。</div>'
    return
  }
  rows.forEach(r => {
    const color = CAT_COLORS[r.category] || '#555'
    const dur   = r.duration_sec ? fmtSecShort(r.duration_sec) : '計測中…'
    list.innerHTML += `
      <div class="session-row">
        <div class="sdot" style="background:${color}"></div>
        <span class="sname">${escHtml(r.name)}</span>
        <span class="scat">${r.category}</span>
        <span class="sdur">${dur}</span>
        <span class="stime">${fmtTime(r.started_at)}</span>
      </div>`
  })
}

// ── LION EYE ─────────────────────────────────────
;(function initLionEye() {
  const today = todayISO()
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().split('T')[0]
  document.getElementById('lion-start').value = weekAgo
  document.getElementById('lion-end').value   = today
})()

document.getElementById('btn-lion-run').addEventListener('click', () => {
  const start = document.getElementById('lion-start').value
  const end   = document.getElementById('lion-end').value
  if (!start || !end) return

  const result  = document.getElementById('lion-result')
  const period  = document.getElementById('lion-period')
  const btn     = document.getElementById('btn-lion-run')

  result.innerHTML  = '<div class="loading"><div class="spin"></div>LION EYE 分析中…</div>'
  period.textContent = `${start} 〜 ${end}`
  btn.disabled = true

  // 設定からモード取得
  window.inkHabit.getConfig()
  window._lionEyePending = { start, end }
})

function runLionEye(config, start, end) {
  window.inkHabit.lionEye({
    mode:        config.llm_mode || 'basic',
    model:       config.ollama_model || '',
    range_start: start,
    range_end:   end
  })
}

function renderLionEye(content) {
  const result = document.getElementById('lion-result')
  document.getElementById('btn-lion-run').disabled = false

  const lines = content.split('\n').filter(l => l.trim())
  if (lines.length === 0) {
    result.innerHTML = '<div class="empty">この期間に記録されたセッションがありません。</div>'
    return
  }

  result.innerHTML = '<div class="trend-list">' +
    lines.map(line => {
      const body = line.replace(/^→\s*/, '')
      return `<div class="trend-row">
        <span class="trend-arrow">→</span>
        <span class="trend-body">${escHtml(body)}</span>
      </div>`
    }).join('') +
  '</div>'
}

// ── リマインダー ──────────────────────────────────
window.inkHabit.onReminderFired(data => {
  reminderCount++
  const warn = document.getElementById('remind-warn')
  const msg  = document.getElementById('remind-msg')
  const session = activeSessions.find(s => s.id === data.session_id)
  if (session) {
    msg.textContent = `「${session.name}」開始から ${data.elapsed_min} 分経過。切り替えを忘れていませんか？`
  }
  warn.classList.add('visible')
  setTimeout(() => warn.classList.remove('visible'), 10000)
})

// ── 設定 ─────────────────────────────────────────
function renderSettings(config) {
  document.getElementById('s-reminder').value   = config.reminder_minutes || 60
  document.getElementById('s-llm-mode').value   = config.llm_mode || 'ollama'
  updateLLMRows(config.llm_mode || 'ollama')

  window.inkHabit.getAutoLaunch().then(on => {
    document.getElementById('toggle-startup').classList.toggle('on', on)
  })
}

function updateLLMRows(mode) {
  document.getElementById('s-row-ollama').style.display = mode === 'ollama' ? '' : 'none'
  if (mode === 'ollama') loadOllamaModels()
}

document.getElementById('s-llm-mode').addEventListener('change', e => {
  updateLLMRows(e.target.value)
})

function loadOllamaModels() {
  window.inkHabit.getOllamaModels()
}

document.getElementById('toggle-startup').addEventListener('click', function() {
  const on = !this.classList.contains('on')
  this.classList.toggle('on', on)
  window.inkHabit.setAutoLaunch(on)
})

document.getElementById('btn-save-settings').addEventListener('click', () => {
  const config = {
    reminder_minutes: parseInt(document.getElementById('s-reminder').value) || 60,
    llm_mode:         document.getElementById('s-llm-mode').value,
    ollama_model:     document.getElementById('s-ollama-model').value,
  }
  window.inkHabit.saveConfig(config)
  const btn = document.getElementById('btn-save-settings')
  btn.textContent = '保存しました ✓'
  setTimeout(() => { btn.textContent = '設定を保存' }, 2000)
})

// ── Pythonメッセージ処理 ──────────────────────────
window.inkHabit.onPythonMessage(msg => {
  switch (msg.type) {

    case 'ready':
      window.inkHabit.getConfig()
      window.inkHabit.getActiveSessions().then(sessions => {
        activeSessions = sessions
        renderActiveSessions()
      })
      loadSuggestions()
      loadTodaySessions()
      break

    case 'session-started':
      activeSessions.push({
        id:            msg.id,
        name:          msg.name || document.getElementById('task-input').dataset.lastName || '',
        category:      msg.category,
        started_at:    msg.started_at,
        estimated_sec: msg.estimated_sec || null
      })
      renderActiveSessions()
      loadSuggestions()
      loadTodaySessions()
      break

    case 'session-stopped':
      activeSessions = activeSessions.filter(s => s.id !== msg.session_id)
      renderActiveSessions()
      loadTodaySessions()
      break

    case 'session-past-added':
      loadTodaySessions()
      loadSuggestions()
      break

    case 'category-updated':
      loadTodaySessions()
      break

    case 'db-result':
      if (msg.rows) {
        // 今日タブ or 全件ログ
        const activeTab = document.querySelector('.tab-content.active')?.id
        if (activeTab === 'tab-today') renderTodaySessions(msg.rows)
        if (activeTab === 'tab-log')   renderAllSessions(msg.rows)
      }
      break

    case 'suggestions':
      renderSuggestions(msg.items || [])
      break

    case 'lion-eye-done':
      renderLionEye(msg.content || '')
      break

    case 'ollama-models':
      updateOllamaSelect(msg.models || [])
      break

    case 'config':
      renderSettings(msg.data || {})
      // LION EYE pending
      if (window._lionEyePending) {
        const { start, end } = window._lionEyePending
        delete window._lionEyePending
        runLionEye(msg.data, start, end)
      }
      break

    case 'config-saved':
      break

    case 'error':
      console.error('[worker error]', msg.message)
      break
  }
})

// ── Ollama選択肢更新 ──────────────────────────────
function updateOllamaSelect(models) {
  const sel = document.getElementById('s-ollama-model')
  const cur = sel.value
  sel.innerHTML = ''
  if (models.length === 0) {
    sel.innerHTML = '<option value="">モデルなし（Ollama未起動？）</option>'
    return
  }
  models.forEach(m => {
    const opt = document.createElement('option')
    opt.value = m; opt.textContent = m
    if (m === cur) opt.selected = true
    sel.appendChild(opt)
  })
}

// ── フォーカス指示 ────────────────────────────────
window.inkHabit.onFocusInput(() => {
  document.getElementById('task-input').focus()
})

window.inkHabit.onShowTab(tab => switchTab(tab))

// ── カテゴリインライン編集 ────────────────────────
function startCatEdit(el) {
  const sessionId = el.dataset.id
  const current   = el.dataset.cat
  const input     = document.createElement('input')
  input.className = 'scat-input'
  input.value     = current
  el.replaceWith(input)
  input.focus()
  input.select()

  const commit = () => {
    const newCat = input.value.trim() || current
    window.inkHabit.sessionUpdateCategory({ session_id: parseInt(sessionId), category: newCat })
    const span = document.createElement('span')
    span.className    = 'scat-edit'
    span.dataset.id   = sessionId
    span.dataset.cat  = newCat
    span.textContent  = newCat
    span.addEventListener('click', () => startCatEdit(span))
    input.replaceWith(span)
    loadTodaySessions()
  }

  input.addEventListener('blur',    commit)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { input.blur() }
    if (e.key === 'Escape') { input.value = current; input.blur() }
  })
}

// ── 過去セッション追加モーダル ────────────────────
document.getElementById('btn-add-past').addEventListener('click', () => {
  document.getElementById('past-date').value  = todayISO()
  document.getElementById('past-name').value  = ''
  document.getElementById('past-category').value = ''
  document.getElementById('past-start').value = ''
  document.getElementById('past-end').value   = ''
  document.getElementById('modal-past').classList.add('visible')
  document.getElementById('past-name').focus()
})

document.getElementById('modal-cancel').addEventListener('click', () => {
  document.getElementById('modal-past').classList.remove('visible')
})

document.getElementById('modal-past').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-past'))
    document.getElementById('modal-past').classList.remove('visible')
})

document.getElementById('modal-submit').addEventListener('click', () => {
  const name     = document.getElementById('past-name').value.trim()
  const category = document.getElementById('past-category').value.trim()
  const date     = document.getElementById('past-date').value
  const start    = document.getElementById('past-start').value
  const end      = document.getElementById('past-end').value

  if (!name || !date || !start || !end) return

  const startedAt = `${date}T${start}:00`
  const endedAt   = `${date}T${end}:00`

  if (endedAt <= startedAt) {
    alert('終了時刻は開始時刻より後にしてください。')
    return
  }

  window.inkHabit.sessionAddPast({ name, category, started_at: startedAt, ended_at: endedAt })
  document.getElementById('modal-past').classList.remove('visible')
})

// ── XSS対策 ──────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── 初期化 ────────────────────────────────────────
document.getElementById('today-date').textContent =
  new Date().toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })
