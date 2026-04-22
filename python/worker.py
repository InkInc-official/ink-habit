#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ink Habit — Python Worker v2
SQLite DB管理 / マルチ計測 / LION EYE分析 / Ollama・Gemini連携
"""

import sys
import json
import os
import sqlite3
import datetime
import threading
from pathlib import Path

# ── パス ─────────────────────────────────────────
if sys.platform == 'win32':
    APP_DIR = Path(os.environ.get('APPDATA', Path.home())) / 'ink-habit'
else:
    APP_DIR = Path.home() / '.ink-habit'

APP_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH     = APP_DIR / 'ink_habit.db'
CONFIG_PATH = APP_DIR / 'config.json'

# ── DB初期化 ──────────────────────────────────────
def init_db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    cur.executescript('''
    CREATE TABLE IF NOT EXISTS sessions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT    NOT NULL,
        category        TEXT    NOT NULL DEFAULT 'その他',
        started_at      TEXT    NOT NULL,
        ended_at        TEXT,
        duration_sec    INTEGER,
        estimated_sec   INTEGER,
        note            TEXT
    );

    CREATE TABLE IF NOT EXISTS reminders (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  INTEGER NOT NULL,
        fired_at    TEXT    NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS reports (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        range_start TEXT    NOT NULL,
        range_end   TEXT    NOT NULL,
        mode        TEXT    NOT NULL,
        model       TEXT,
        content     TEXT    NOT NULL,
        created_at  TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
    );
    ''')
    con.commit()
    con.close()

# ── 設定 ──────────────────────────────────────────
DEFAULT_CONFIG = {
    'llm_mode':            'ollama',
    'ollama_model':        'qwen2.5:7b',
    'gemini_api_key':      '',
    'reminder_minutes':    60,
    'startup':             True,
    'category_limits': {
        '配信':    180,
        '制作':    120,
        '事務':     60,
        'リサーチ':  45,
        '休憩':     30,
        'その他':   60
    }
}

def load_config():
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, encoding='utf-8') as f:
                data = json.load(f)
            merged = {**DEFAULT_CONFIG, **data}
            merged['category_limits'] = {
                **DEFAULT_CONFIG['category_limits'],
                **data.get('category_limits', {})
            }
            return merged
        except Exception:
            pass
    config = dict(DEFAULT_CONFIG)
    config['gemini_api_key'] = os.environ.get('GEMINI_API_KEY', '')
    return config

def save_config(data):
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# ── カテゴリ自動判定 ──────────────────────────────
CATEGORY_KEYWORDS = {
    '配信':    ['配信', 'ライブ', 'iriam', 'twitch', 'youtube', '本番', 'live'],
    '制作':    ['イラスト', '音楽', '動画', '編集', 'ai', '制作', '作曲', '作詞',
                'デザイン', '歌詞', 'suno', 'seaart', 'spell'],
    '事務':    ['事務', 'メール', '請求', '管理', '書類', 'ink memory', 'ink triage',
                'notion', 'discord', 'bot', '更新'],
    'リサーチ': ['調べ', 'リサーチ', '勉強', '読書', '学習', '検索', '情報収集'],
    '休憩':    ['休憩', '食事', '散歩', '休み', '昼食', '夕食', '睡眠']
}

def detect_category(name: str) -> str:
    n = name.lower()
    for cat, keywords in CATEGORY_KEYWORDS.items():
        if any(k in n for k in keywords):
            return cat
    return 'その他'

# ── タスク名の正規化（表記ゆれ対策） ────────────────
TASK_ALIASES = {
    'ライブ':       '配信',
    'live配信':     '配信',
    'iriam配信':    'IRIAM配信',
    '作曲':         'AI音楽制作',
    '音楽制作':     'AI音楽制作',
    '楽曲制作':     'AI音楽制作',
    'イラスト制作': 'AIイラスト制作',
    'お絵描き':     'AIイラスト制作',
}

def normalize_task_name(name: str) -> str:
    n_lower = name.lower().strip()
    for alias, canonical in TASK_ALIASES.items():
        if alias in n_lower:
            return canonical
    return name.strip()

# ── DB操作 ────────────────────────────────────────
def get_con():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con

def db_query(table, where=None, order=None, limit=None):
    con = get_con()
    cur = con.cursor()
    sql = f'SELECT * FROM {table}'
    params = []
    if where:
        conds = [f'{k}=?' for k in where]
        sql += ' WHERE ' + ' AND '.join(conds)
        params = list(where.values())
    if order:
        sql += f' ORDER BY {order}'
    if limit:
        sql += f' LIMIT {limit}'
    cur.execute(sql, params)
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows

def db_insert(table, data):
    con = get_con()
    cur = con.cursor()
    keys   = ', '.join(data.keys())
    places = ', '.join(['?'] * len(data))
    cur.execute(f'INSERT INTO {table} ({keys}) VALUES ({places})', list(data.values()))
    row_id = cur.lastrowid
    con.commit()
    con.close()
    return row_id

def db_update(table, data, where):
    con = get_con()
    cur = con.cursor()
    sets  = ', '.join([f'{k}=?' for k in data])
    conds = ' AND '.join([f'{k}=?' for k in where])
    params = list(data.values()) + list(where.values())
    cur.execute(f'UPDATE {table} SET {sets} WHERE {conds}', params)
    con.commit()
    con.close()

# 過去のタスク名サジェスト（上位10件）
def get_task_suggestions():
    con = get_con()
    cur = con.cursor()
    cur.execute('''
        SELECT name, COUNT(*) as cnt
        FROM sessions
        GROUP BY name
        ORDER BY cnt DESC
        LIMIT 10
    ''')
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return [r['name'] for r in rows]

# タスク名から過去のカテゴリを学習して返す
def get_learned_category(name: str) -> str:
    con = get_con()
    cur = con.cursor()
    cur.execute('''
        SELECT category FROM sessions
        WHERE name = ? AND ended_at IS NOT NULL
        ORDER BY started_at DESC
        LIMIT 1
    ''', (name,))
    row = cur.fetchone()
    con.close()
    if row:
        return row['category']
    return detect_category(name)

# 過去セッションを手動追加
def add_past_session(name, category, started_at, ended_at):
    name = normalize_task_name(name)
    if not category:
        category = get_learned_category(name)
    start_dt     = datetime.datetime.fromisoformat(started_at)
    end_dt       = datetime.datetime.fromisoformat(ended_at)
    duration_sec = max(0, int((end_dt - start_dt).total_seconds()))
    return db_insert('sessions', {
        'name':         name,
        'category':     category,
        'started_at':   started_at,
        'ended_at':     ended_at,
        'duration_sec': duration_sec
    })

# ── マルチ計測：アクティブセッション取得 ────────────
def get_active_sessions():
    con = get_con()
    cur = con.cursor()
    cur.execute('''
        SELECT * FROM sessions
        WHERE ended_at IS NULL
        ORDER BY started_at ASC
    ''')
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows

# ── セッション開始 ────────────────────────────────
def start_session(name, estimated_sec=None):
    name     = normalize_task_name(name)
    category = get_learned_category(name)
    now      = datetime.datetime.now().isoformat()
    data = {
        'name':          name,
        'category':      category,
        'started_at':    now,
        'estimated_sec': estimated_sec
    }
    row_id = db_insert('sessions', data)
    return row_id, category

# ── セッション終了 ────────────────────────────────
def stop_session(session_id):
    now = datetime.datetime.now().isoformat()
    con = get_con()
    cur = con.cursor()
    cur.execute('SELECT started_at FROM sessions WHERE id=?', (session_id,))
    row = cur.fetchone()
    con.close()
    if not row:
        return None
    started = datetime.datetime.fromisoformat(row['started_at'])
    ended   = datetime.datetime.fromisoformat(now)
    duration_sec = int((ended - started).total_seconds())
    db_update('sessions', {
        'ended_at':     now,
        'duration_sec': duration_sec
    }, {'id': session_id})
    return duration_sec

# ── 重複セッション検出 ────────────────────────────
def find_concurrent_sessions(session_id):
    """指定セッションと時間が重複した他セッションを返す"""
    con = get_con()
    cur = con.cursor()
    cur.execute('SELECT started_at, ended_at FROM sessions WHERE id=?', (session_id,))
    target = cur.fetchone()
    if not target:
        con.close()
        return []
    s = target['started_at']
    e = target['ended_at'] or datetime.datetime.now().isoformat()
    cur.execute('''
        SELECT * FROM sessions
        WHERE id != ?
          AND started_at < ?
          AND (ended_at > ? OR ended_at IS NULL)
    ''', (session_id, e, s))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows

# ── LION EYE 分析 ─────────────────────────────────
def build_lion_eye_prompt(range_start: str, range_end: str) -> str:
    con = get_con()
    cur = con.cursor()

    # 期間内セッション取得
    cur.execute('''
        SELECT id, name, category, started_at, ended_at, duration_sec, estimated_sec
        FROM sessions
        WHERE started_at >= ? AND started_at <= ?
          AND ended_at IS NOT NULL
        ORDER BY started_at
    ''', (range_start, range_end + 'T23:59:59'))
    sessions = [dict(r) for r in cur.fetchall()]
    con.close()

    if not sessions:
        return None

    # カテゴリ別集計
    by_cat = {}
    by_name = {}
    for s in sessions:
        cat  = s['category']
        name = s['name']
        dur  = s['duration_sec'] or 0
        by_cat[cat]  = by_cat.get(cat, 0) + dur
        if name not in by_name:
            by_name[name] = {'count': 0, 'total_sec': 0, 'estimated_sec_list': []}
        by_name[name]['count']     += 1
        by_name[name]['total_sec'] += dur
        if s['estimated_sec']:
            by_name[name]['estimated_sec_list'].append(s['estimated_sec'])

    # 重複セッション分析
    concurrent_pairs = []
    for i, s1 in enumerate(sessions):
        for s2 in sessions[i+1:]:
            s1_end = s1['ended_at'] or ''
            s2_end = s2['ended_at'] or ''
            if s1['started_at'] < s2_end and s1_end > s2['started_at']:
                pair = tuple(sorted([s1['name'], s2['name']]))
                if pair not in concurrent_pairs:
                    concurrent_pairs.append(pair)

    # 時間帯分析
    hour_counts = {}
    for s in sessions:
        hour = datetime.datetime.fromisoformat(s['started_at']).hour
        hour_counts[hour] = hour_counts.get(hour, 0) + 1

    peak_hour = max(hour_counts, key=hour_counts.get) if hour_counts else None

    # 見積もり精度
    estimate_diffs = []
    for name, data in by_name.items():
        ests = data['estimated_sec_list']
        if ests and data['count'] > 0:
            avg_est    = sum(ests) / len(ests)
            avg_actual = data['total_sec'] / data['count']
            diff_min   = (avg_actual - avg_est) / 60
            estimate_diffs.append((name, diff_min))

    # データテキスト構築
    total_sec = sum(s['duration_sec'] or 0 for s in sessions)
    lines = [
        f'分析期間: {range_start} 〜 {range_end}',
        f'総活動時間: {total_sec//3600}時間{(total_sec%3600)//60}分',
        f'セッション数: {len(sessions)}件',
        '',
        '【カテゴリ別時間】'
    ]
    for cat, sec in sorted(by_cat.items(), key=lambda x: -x[1]):
        lines.append(f'  {cat}: {sec//3600}時間{(sec%3600)//60}分')

    lines += ['', '【タスク別実績（回数・平均時間）】']
    for name, data in sorted(by_name.items(), key=lambda x: -x[1]['count']):
        avg = data['total_sec'] // data['count'] if data['count'] else 0
        lines.append(f'  「{name}」: {data["count"]}回 / 平均{avg//60}分')

    if concurrent_pairs:
        lines += ['', '【同時並行が確認されたタスクの組み合わせ】']
        for a, b in concurrent_pairs:
            lines.append(f'  「{a}」×「{b}」')

    if peak_hour is not None:
        lines += ['', f'【最多開始時間帯】{peak_hour}時台（{hour_counts[peak_hour]}件）']

    if estimate_diffs:
        lines += ['', '【見積もりと実績の差（平均）】']
        for name, diff in estimate_diffs:
            sign = '+' if diff >= 0 else ''
            lines.append(f'  「{name}」: {sign}{diff:.0f}分')

    data_text = '\n'.join(lines)

    return f'''以下の活動記録データを分析し、事実のみを日本語で出力してください。

ルール：
- 感情・評価・アドバイス・励ましは一切禁止
- 各項目は必ず「→ 」で始める
- 1項目につき1文、40字以内
- 出力は5〜7項目のみ。前置き・後書き・説明は不要
- 見積もりデータがない場合はその項目を省略する
- 「〜過多」「〜不足」などの評価語は使わず、数値や事実で表現する

出力例：
→ 総活動時間は3時間12分、8セッション。
→ 最多カテゴリは「制作」（1時間44分）。
→ 「AI音楽制作」は5回実施、平均21分。
→ 配信と制作の並行セッションが3件確認された。
→ セッション開始は13時台に集中（4件）。
→ 「歌詞作成」の見積もりより実績が平均+18分長い。

データ：
{data_text}'''

def generate_lion_eye(mode, model, range_start, range_end):
    config = load_config()
    prompt = build_lion_eye_prompt(range_start, range_end)
    if not prompt:
        return 'この期間に記録されたセッションがありません。'
    try:
        if mode == 'ollama':
            return ollama_generate(model or config['ollama_model'], prompt)
        else:
            return _basic_lion_eye(range_start, range_end)
    except Exception as e:
        return f'LION EYE 生成エラー: {str(e)}'

def _basic_lion_eye(range_start, range_end):
    """AIなしの基本分析（basicモード）"""
    con = get_con()
    cur = con.cursor()
    cur.execute('''
        SELECT name, category, started_at, ended_at, duration_sec, estimated_sec
        FROM sessions
        WHERE started_at >= ? AND started_at <= ?
          AND ended_at IS NOT NULL
        ORDER BY started_at
    ''', (range_start, range_end + 'T23:59:59'))
    sessions = [dict(r) for r in cur.fetchall()]
    con.close()

    if not sessions:
        return 'この期間に記録されたセッションがありません。'

    results = []
    total_sec = sum(s['duration_sec'] or 0 for s in sessions)
    results.append(f'→ 総活動時間は{total_sec//3600}時間{(total_sec%3600)//60}分、{len(sessions)}セッション。')

    by_cat = {}
    for s in sessions:
        cat = s['category']
        by_cat[cat] = by_cat.get(cat, 0) + (s['duration_sec'] or 0)
    top_cat = max(by_cat, key=by_cat.get)
    results.append(f'→ 最多カテゴリは「{top_cat}」（{by_cat[top_cat]//3600}時間{(by_cat[top_cat]%3600)//60}分）。')

    by_name = {}
    for s in sessions:
        n = s['name']
        by_name[n] = by_name.get(n, 0) + 1
    top_task = max(by_name, key=by_name.get)
    results.append(f'→ 最多タスクは「{top_task}」（{by_name[top_task]}回）。')

    hour_counts = {}
    for s in sessions:
        h = datetime.datetime.fromisoformat(s['started_at']).hour
        hour_counts[h] = hour_counts.get(h, 0) + 1
    peak = max(hour_counts, key=hour_counts.get)
    results.append(f'→ 最多開始時間帯は{peak}時台（{hour_counts[peak]}件）。')

    concurrent = 0
    for i, s1 in enumerate(sessions):
        for s2 in sessions[i+1:]:
            if s1['started_at'] < s2['ended_at'] and s1['ended_at'] > s2['started_at']:
                concurrent += 1
    if concurrent > 0:
        results.append(f'→ 並行セッションが{concurrent}件確認された。')

    diffs = []
    for s in sessions:
        if s['estimated_sec'] and s['duration_sec']:
            diffs.append(s['duration_sec'] - s['estimated_sec'])
    if diffs:
        avg_diff = sum(diffs) / len(diffs)
        sign = '+' if avg_diff >= 0 else ''
        results.append(f'→ 見積もりと実績の平均差は{sign}{avg_diff/60:.0f}分。')

    return '\n'.join(results)

# ── Ollama連携 ────────────────────────────────────
def get_ollama_models():
    try:
        import urllib.request
        with urllib.request.urlopen('http://localhost:11434/api/tags', timeout=3) as r:
            data = json.loads(r.read())
        return [m['name'] for m in data.get('models', [])]
    except Exception:
        return []

def ollama_generate(model, prompt):
    import urllib.request
    payload = json.dumps({'model': model, 'prompt': prompt, 'stream': False}).encode()
    req = urllib.request.Request(
        'http://localhost:11434/api/generate',
        data=payload,
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.loads(r.read())
    return data.get('response', '')

# ── Gemini連携 ────────────────────────────────────
def gemini_generate(api_key, prompt):
    import urllib.request
    import time
    url = (
        'https://generativelanguage.googleapis.com/v1beta/'
        f'models/gemini-2.0-flash:generateContent?key={api_key}'
    )
    payload = json.dumps({
        'contents': [{'parts': [{'text': prompt}]}]
    }).encode()

    for attempt in range(3):
        req = urllib.request.Request(
            url, data=payload,
            headers={'Content-Type': 'application/json'}
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read())
            return data['candidates'][0]['content']['parts'][0]['text']
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:
                time.sleep(10 * (attempt + 1))
                continue
            raise

# ── メッセージループ ──────────────────────────────
def send(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)

def handle(msg):
    action = msg.get('action')

    # ── セッション操作 ──
    if action == 'session-start':
        estimated_sec = msg.get('estimated_sec')
        raw_name      = msg['name']
        session_id, category = start_session(raw_name, estimated_sec)
        send({
            'type':          'session-started',
            'req':           msg.get('req'),
            'id':            session_id,
            'name':          normalize_task_name(raw_name),
            'category':      category,
            'started_at':    datetime.datetime.now().isoformat(),
            'estimated_sec': estimated_sec
        })

    elif action == 'session-stop':
        duration_sec = stop_session(msg['session_id'])
        send({
            'type':         'session-stopped',
            'req':          msg.get('req'),
            'session_id':   msg['session_id'],
            'duration_sec': duration_sec
        })

    elif action == 'session-active':
        sessions = get_active_sessions()
        send({'type': 'session-active', 'req': msg.get('req'), 'sessions': sessions})

    elif action == 'session-concurrent':
        pairs = find_concurrent_sessions(msg['session_id'])
        send({'type': 'session-concurrent', 'req': msg.get('req'), 'sessions': pairs})

    # ── DB汎用操作 ──
    elif action == 'db-query':
        rows = db_query(msg['table'], msg.get('where'), msg.get('order'), msg.get('limit'))
        send({'type': 'db-result', 'req': msg.get('req'), 'rows': rows})

    elif action == 'db-update':
        db_update(msg['table'], msg['data'], msg['where'])
        send({'type': 'db-updated', 'req': msg.get('req')})

    # ── 過去セッション手動追加 ──
    elif action == 'session-add-past':
        row_id = add_past_session(
            msg['name'],
            msg.get('category', ''),
            msg['started_at'],
            msg['ended_at']
        )
        send({'type': 'session-past-added', 'req': msg.get('req'), 'id': row_id})

    # ── カテゴリ更新 ──
    elif action == 'session-update-category':
        db_update('sessions',
            {'category': msg['category']},
            {'id': msg['session_id']}
        )
        send({'type': 'category-updated', 'req': msg.get('req'), 'session_id': msg['session_id']})

    # ── サジェスト ──
    elif action == 'get-suggestions':
        suggestions = get_task_suggestions()
        send({'type': 'suggestions', 'req': msg.get('req'), 'items': suggestions})

    # ── LION EYE ──
    elif action == 'lion-eye':
        def run():
            content = generate_lion_eye(
                msg.get('mode', 'basic'),
                msg.get('model'),
                msg.get('range_start', datetime.date.today().isoformat()),
                msg.get('range_end',   datetime.date.today().isoformat())
            )
            db_insert('reports', {
                'range_start': msg.get('range_start'),
                'range_end':   msg.get('range_end'),
                'mode':        msg.get('mode', 'basic'),
                'model':       msg.get('model', ''),
                'content':     content,
                'created_at':  datetime.datetime.now().isoformat()
            })
            send({'type': 'lion-eye-done', 'req': msg.get('req'), 'content': content})
        threading.Thread(target=run, daemon=True).start()

    # ── リマインダー記録 ──
    elif action == 'reminder-fired':
        db_insert('reminders', {
            'session_id': msg['session_id'],
            'fired_at':   datetime.datetime.now().isoformat()
        })
        send({'type': 'reminder-recorded', 'req': msg.get('req')})

    # ── Ollamaモデル一覧 ──
    elif action == 'get-ollama-models':
        models = get_ollama_models()
        send({'type': 'ollama-models', 'models': models})

    # ── 設定 ──
    elif action == 'get-config':
        send({'type': 'config', 'data': load_config()})

    elif action == 'save-config':
        save_config(msg['data'])
        send({'type': 'config-saved'})

    elif action == 'quit':
        sys.exit(0)

def main():
    init_db()
    send({'type': 'ready'})
    buf = ''
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            handle(msg)
        except Exception as e:
            send({'type': 'error', 'message': str(e)})

if __name__ == '__main__':
    main()
