# epoku — 学生向け休憩スポットAIマップ

DevFest GDGoC Japan Hackathon 2026 / チーム **epoku**（エントリー番号 DF-2026-T031・東京会場）の開発リポジトリ。

> ⚠️ 運営から招待された公式 GitHub リポジトリとは別物です。開発途中のコードを公式リポジトリへ誤って push しないこと（11/4 #20 で注意喚起あり）。

## 一言でいうと

マップを中心に、休憩できる場所（ベンチ・日陰・屋根・トイレ・ゴミ箱）を探せて、**「そこに実際に座れるか（空席確率・混雑）」をカメラ／センサーなしで AI が推定する**。日陰は Google Earth 系の 3D データ（建物の高さ・太陽位置）から時間別に予測する。

- **ターゲット**: 学生（提案段階）
- **審査向けの言い方**: 「体調が悪くなる前に休む」
- **デモ対象エリア**: みなとみらい／横浜（「多分」付き。会場周辺を追加する案もあり）
- **最終形**: モバイルアプリ。当日は **APK（Android）＋ Web アプリ（iPhone の人向け）** で見せる

**MVP: [docs/mvp.md](docs/mvp.md)** ／ 詳細: [docs/idea.md](docs/idea.md) ／ 技術: [docs/architecture.md](docs/architecture.md) ／ ピッチ: [docs/pitch.md](docs/pitch.md) ／ 出典: [docs/sources.md](docs/sources.md)

## スケジュール

| 日付 | 内容 |
| --- | --- |
| 11/1 | キックオフ・テーマ発表 |
| **11/5〜11/10** | **開発期間（6日間）**。Google Cloud クレジット配布 |
| 11/14 10:00〜16:00 | Regional Day（東京）。上位10チームが Demo Day へ |
| 11/27 10:00〜12:00 | Demo Day（Google 渋谷） |
| 11/29 | DevFest Tokyo（KITTE）。最優秀は LT 登壇・学生展示 |

## 開発方針（11/4 時点）

1. **まず API なしで動くデモ版を作る** → グラフィック・UX を確認してから API を入れる
2. API キーがなくても動き、キーを入れると API 機能が追加される作りにする
3. 35 機能を一度に作らず、機能単位で作る。競合にある基本機能は押さえた上で差別化機能を足す
4. クレジットは約 20 ドル。各 API の無料枠・上限設定を確認してから使う

## 技術スタック（候補）

| 用途 | 候補 | 状態 |
| --- | --- | --- |
| 地図表示・経路 | Google Maps API（アプリ内で経路表示。Google マップへ飛ばさない） | ✅ |
| 日陰・建物の高さ | Google Earth Engine（Google Cloud 経由）／ Solar API | △ 調査中 |
| 日陰・屋根を考慮したルート | Routes API | △ 調査中 |
| AI | Gemini API | ✅ |
| バックエンド | Firebase | △ |
| 配布 | APK ＋ Web | △ |

## ディレクトリ構成

```
.
├── app/          # アプリ本体（スタック確定後にセットアップ）
├── docs/
│   ├── idea.md          # コンセプト・35機能・MVP・未確定事項
│   ├── architecture.md  # 技術方針・API 調査
│   ├── pitch.md         # ピッチ構成・審査基準
│   └── sources.md       # 議事録などの出典（Google Drive）
└── .env.example
```

## セットアップ

```bash
cp .env.example .env
# .env に API キー等を記入（.env はコミットしない）
```
