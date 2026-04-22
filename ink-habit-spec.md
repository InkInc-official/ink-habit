# Ink Habit — 仕様書 v1.0
**by Ink Inc. / 黒井葉跡（所長）**
作成日: 2026-04-17

---

## 1. プロダクト概要

### コンセプト
「今から何をするか宣言してから始める」ワンクッションツール。
ADHD気質による過集中・注意散漫・脱線を可視化し、時間のフローに気づきを与える。

### ターゲット
- **プライマリ**: 所長本人（Windows/Linux PC）
- **セカンダリ**: IRIAMライバー・配信者・クリエイター（スマホメイン）
- **オープン**: ADHDや過集中傾向のあるすべての人（OSSとして公開）

### OSSライセンス
CC BY-NC 4.0（HabitHawkの踏襲）→ MITに変更も検討

---

## 2. 三段構えのモード

| モード | 概要 | 必要なもの |
|--------|------|-----------|
| ① 基本モード | 記録・計測・アラートのみ。AIなし | なし |
| ② ローカルLLMモード | Ollamaで週次振り返りを生成 | Ollama（オフライン・無料） |
| ③ Gemini APIモード | 高品質な振り返りと分析 | Gemini APIキー |

モード切替はInk Script同様、設定モーダルのラジオカードで行う。

---

## 3. 画面構成

### 3-1. デスクトップ版（Electron）

```
┌─────────────────────────────────────────────┐
│ タイトルバー: Ink Habit  [モードバッジ] [─][□][✕] │
├──────────────┬──────────────────────────────┤
│              │ タブ: [今日] [週次] [設定]      │
│  サイドバー   ├──────────────────────────────┤
│              │                              │
│ ┌──────────┐ │      メインエリア              │
│ │活動名入力  │ │                              │
│ └──────────┘ │                              │
│  上限: [60]分 │                              │
│ [▶ 開始]     │                              │
│              │                              │
│ ──今日──     │                              │
│ タイムライン  │                              │
│              │                              │
│ ──フッター── │                              │
│ [⚙ LLM設定] │                              │
└──────────────┴──────────────────────────────┘
```

### 3-2. ブラウザ版（Web）
- 同一HTMLをVercelにデプロイ
- データ保存はlocalStorage
- AI連携はGemini APIをフロントから直接呼ぶ
- スマホ対応レイアウト（レスポンシブ）

---

## 4. 機能仕様

### 4-1. 記録機能（① 全モード共通）

**活動入力**
- 自由記述テキスト入力（例：「リサーチ」「配信準備」「音楽制作」）
- 上限時間を分単位で設定（デフォルト60分）
- 開始ボタンを押すとタイマースタート
- 複数タイマーの同時起動可能

**タイマー表示**
- 現在の活動名を大きく表示（メインの主役）
- 経過時間をMM:SS / HH:MM形式で表示
- 上限に対するプログレスバー
  - 0〜79%: パープル
  - 80〜99%: アンバー（警告）
  - 100%〜: レッド（超過）

**アラート**
- 上限80%でトースト通知「そろそろ切り替えを検討してみては？」
- 上限100%でトースト通知「上限を超過しています」
- 通知はOSのシステム通知（Electron版）またはブラウザ通知（Web版）
- 音・強制割り込みはしない（穏やかな気づき）

**完了・記録**
- 停止ボタンで活動終了 → SQLite/localStorageに自動保存
- 5秒未満のセッションは保存しない

### 4-2. 今日タブ

- 当日のタイムライン（時系列で活動を並べる）
- 活動別の累計時間バー
- カテゴリ別の円グラフ（AIがカテゴリを自動付与）
- 現在進行中の活動をハイライト

### 4-3. 週次タブ

- 過去7日間の活動サマリー
- 曜日別・活動別のヒートマップ
- AIによる振り返りテキスト（②③のみ）
  - 「音楽制作に時間が偏っていました」
  - 「水曜日は記録が少なく、記録漏れの可能性があります」
  - HabitHawkの「感情を排した客観的分析」の思想を継承

### 4-4. 脱線検知

- 同じカテゴリの活動が連続して上限超過している場合に通知
- 「30分以上記録がありません。記録を忘れていませんか？」（無記録アラート）
- 無記録アラートの間隔は設定で変更可能（デフォルト30分）

---

## 5. データ設計

### SQLite テーブル（Electron版）

```sql
-- 活動ログ
CREATE TABLE activities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  category     TEXT,              -- AIが自動付与
  started_at   TEXT NOT NULL,     -- ISO8601
  ended_at     TEXT,
  duration_sec INTEGER,
  note         TEXT
);

-- AIレポートキャッシュ
CREATE TABLE reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL,       -- YYYY-MM-DD（月曜日）
  mode       TEXT NOT NULL,       -- ollama / gemini
  content    TEXT NOT NULL,       -- 生成されたレポート本文
  created_at TEXT NOT NULL
);

-- アラート履歴
CREATE TABLE alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER,
  type        TEXT NOT NULL,      -- over_limit / no_record / drift
  fired_at    TEXT NOT NULL
);

-- 設定
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
```

### localStorageキー（ブラウザ版）
- `inkhabit_logs`: 活動ログ（JSON配列）
- `inkhabit_reports`: レポートキャッシュ
- `inkhabit_settings`: 設定

---

## 6. 技術スタック

### Electron版
| レイヤー | 技術 |
|---------|------|
| フレームワーク | Electron 29 |
| UI | HTML/CSS/JS（Ink Scriptと統一） |
| DB | SQLite（Python側で管理） |
| Python worker | sqlite3 / requests（Gemini） / ollama |
| IPC | contextBridge（Ink Scriptと同パターン） |
| ビルド | electron-builder（Win: NSIS / Linux: AppImage） |

### ブラウザ版
| レイヤー | 技術 |
|---------|------|
| ホスティング | Vercel（静的デプロイ） |
| DB | localStorage |
| AI連携 | Gemini API（フロントから直接） |

---

## 7. デザイン言語（Ink Inc. 統一）

Ink Scriptのデザインをそのまま踏襲する。

```css
--gold:     #c9a84c   /* メインアクセント */
--bg:       #0a0a0a   /* 最背面 */
--bg2:      #111111   /* サイドバー・タイトルバー */
--bg3:      #161616   /* カード・入力欄 */
--border:   #1e1e1e
--text:     #e0e0e0
--text-dim: #888888
--green:    #4caf50   /* 正常 */
--red:      #f44336   /* 超過 */
```

カスタムタイトルバー（`frame: false`）、サイドバーレイアウト、モードバッジ、ゴールドのプライマリボタン、すべてInk Scriptと統一。

---

## 8. ファイル構成

```
ink-habit/
├── main.js          ← Electronメイン（Ink Script流用・改変）
├── preload.js       ← contextBridge（window.inkHabit）
├── index.html       ← メインUI
├── renderer.js      ← UIロジック
├── python/
│   └── worker.py    ← SQLite・AI連携
├── assets/
│   ├── icon.ico     ← HabitHawkアイコン流用
│   ├── icon.png
│   └── logo.png
├── package.json
├── .env.example     ← GEMINI_API_KEY=
└── README.md
```

---

## 9. 開発フェーズ

### Phase 1（MVP）
- [ ] 基本モード（記録・タイマー・アラート）
- [ ] SQLite保存
- [ ] 今日タブ（タイムライン・累計）
- [ ] Electron版ビルド（Win/Linux）

### Phase 2
- [ ] 週次タブ（ヒートマップ・サマリー）
- [ ] Ollama連携（ローカルLLM振り返り）
- [ ] 無記録アラート

### Phase 3
- [ ] Gemini API連携
- [ ] ブラウザ版（Vercelデプロイ）
- [ ] GitHub Releases公開

---

## 10. HabitHawkからの変更点

| 項目 | HabitHawk | Ink Habit |
|------|-----------|-----------|
| UI | customtkinter（Python） | Electron（Ink Scriptと統一） |
| DB | SQLite（Python直接） | SQLite（Python worker経由） |
| AI | Gemini APIのみ | 三段構え（なし/Ollama/Gemini） |
| レポート | PDF出力 | アプリ内表示（週次タブ） |
| 対象 | PC専用 | PC（Electron）＋スマホ（ブラウザ） |
| ライセンス | CC BY-NC 4.0 | 要検討（MIT推奨） |

---

*Ink Inc. — AI Creation, Human Care. The Future Drawn Together.*
