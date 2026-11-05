# Google Hackathon

Google ハッカソン用の開発リポジトリ。

## 概要

- **プロダクト名**: TBD
- **一言で**: TBD
- **解決する課題**: TBD
- **ターゲット**: TBD

詳細は [docs/idea.md](docs/idea.md) を参照。

## 技術スタック（候補）

| レイヤー | 候補 |
| --- | --- |
| AI | Gemini API（Google AI Studio / Vertex AI） |
| フロント | Next.js |
| バックエンド | Cloud Run / Firebase Functions |
| DB・認証 | Firebase（Firestore + Auth） |
| ホスティング | Firebase App Hosting / Cloud Run |

確定したら [docs/architecture.md](docs/architecture.md) を更新する。

## ディレクトリ構成

```
.
├── app/          # アプリ本体（スタック確定後にセットアップ）
├── docs/         # アイデア・設計・ピッチ資料
│   ├── idea.md
│   ├── architecture.md
│   └── pitch.md
└── .env.example  # 環境変数のテンプレート
```

## セットアップ

```bash
cp .env.example .env
# .env に API キー等を記入（.env はコミットしない）
```

## スケジュール

| 日付 | マイルストーン |
| --- | --- |
| TBD | アイデア確定 |
| TBD | MVP 完成 |
| TBD | デモ・ピッチ準備 |
| TBD | 提出 |
