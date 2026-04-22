# 🦁 Ink Habit

**活動記録・過集中防止ツール by Ink Inc.**

> 「今から何をするか宣言してから始める」ワンクッションで、過集中と脱線を可視化する。

---

## 概要

Ink Habitは、ADHDや過集中傾向のある方向けに設計された活動記録ツールです。  
タスクを宣言してから始めることで、作業の切り替えを意識的に行えるようサポートします。

- **マルチ計測対応** — 配信しながら音楽制作など、複数タスクを同時計測できます
- **リマインダー通知** — 同じタスクが長時間続くとデスクトップ通知で知らせます
- **LION EYE分析** — 事実ベースの傾向分析。褒めない、叱らない、ただデータを見る
- **サジェスト機能** — 過去のタスク名を候補表示し、表記ゆれを防ぎます
- **完全ローカル動作** — データは端末内にのみ保存。外部に送信しません

---

## 必要な環境

- **Node.js** 18以上 — https://nodejs.org/
- **Python** 3.9以上 — https://www.python.org/
- **Ollama** — https://ollama.com/

---

## セットアップ

### 1. Ollamaのインストールと推奨モデルの準備

```bash
# Ollamaをインストール（Linux）
curl -fsSL https://ollama.com/install.sh | sh

# 推奨モデルをダウンロード（初回のみ・約4GB）
ollama pull qwen2.5:7b
```

Windowsの場合は https://ollama.com/ からインストーラーをダウンロードしてください。

### 2. Ink Habitのセットアップ

```bash
# リポジトリをクローン
git clone https://github.com/InkInc-official/ink-habit.git
cd ink-habit

# 依存パッケージをインストール
npm install

# 起動（Windows）
npm start

# 起動（Linux）
npm start -- --no-sandbox
```

### Linuxでの注意事項

Linux環境によっては以下のエラーが発生することがあります。

```
The SUID sandbox helper binary was found, but is not configured correctly.
```

この場合は `--no-sandbox` オプションを付けて起動してください。

```bash
npm start -- --no-sandbox
```

---

## ビルド（配布用）

```bash
# Windows用 EXEインストーラー
npm run build:win

# Linux用 AppImage + deb
npm run build:linux

# 両方同時
npm run build:all
```

ビルド後は `dist/` フォルダにファイルが生成されます。

---

## グローバルショートカット

どのアプリを使っていても **`Ctrl + Shift + H`** でInk Habitの入力欄にフォーカスが移ります。  
作業を始める前にこのショートカットを押す習慣をつけると効果的です。

---

## LION EYE — AIによる傾向分析

設定画面から2つのモードを選択できます。

| モード | 概要 |
|--------|------|
| ① 基本モード | AIなし。記録データから自動集計。即使える。 |
| ② ローカルLLM | Ollamaを使ってオフラインで分析。推奨。 |

LION EYEは感情・評価・アドバイスを一切含みません。  
データから読み取れる事実と傾向のみを出力します。

---

## データの保存場所

| OS | パス |
|----|------|
| Windows | `%APPDATA%\ink-habit\ink_habit.db` |
| Linux | `~/.ink-habit/ink_habit.db` |

SQLiteファイルです。バックアップはこのファイルをコピーするだけでOKです。

---

## ファイル構成

```
ink-habit/
├── main.js          Electronメインプロセス
├── preload.js       contextBridge (window.inkHabit)
├── index.html       UI本体
├── renderer.js      UIロジック
├── python/
│   └── worker.py    SQLite・AI連携
├── assets/
│   ├── icon.ico     アイコン (Windows)
│   └── icon.png     アイコン (Linux)
├── package.json
├── LICENSE
└── README.md
```

---

## ライセンス

MIT License — 詳細は [LICENSE](./LICENSE) を参照してください。

---

## Ink Inc.

**AI Creation, Human Care. The Future Drawn Together.**

配信者向けツール群を制作・公開しているライバー事務所です。

- Web: https://inkinc-hp.vercel.app/
- X: https://x.com/InkInc_Info
- YouTube: https://www.youtube.com/@InkInc.official
