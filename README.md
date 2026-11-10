# Rest Care — 体調や状況に合った休憩を、取りやすく

DevFest GDGoC Japan Hackathon 2026 / チーム **epoku**（東京会場）

> 誰もが、自分の体調や状況に合った休憩を取りやすい環境をつくる。休む場所だけでなく、休むきっかけも届ける。

外出中に休憩が必要な人のための休憩スポットマップです。対象エリアは横浜・みなとみらいです。

- **休むきっかけ**: 歩き続けた時間と暑さ指数（推定）から、休憩を声かけします。疲れ・使える時間・希望（日陰・屋根・背もたれ・トイレ近くなど）を入れると、候補を選び直します。
- **自分に合った休憩場所**: ベンチ・休憩所・トイレ・給水・屋内休憩所を、着く時刻の日陰と空席の見込みで並べます。日陰は建物と樹木の 3D モデルと太陽の位置から計算します。
- **徒歩ルート**: 日陰を優先した道を選び、日陰と日なたの区間を色分けします。
- **Gemini のひと言**: 予測の理由と休憩の声かけを、ルール側で決めた値だけを渡して文章にします（順位や確率は Gemini に決めさせません）。
- **Google Health（任意）**: 本人が選んだ項目（歩数・活動時間・睡眠・心拍の区分）だけを、当日の集計値で使います。未接続でも手入力で同じ機能を使えます。

## 動かし方

```bash
cd app
npm ci --ignore-scripts
npm run dev:all   # 画面と API（http://127.0.0.1:5188/）
npm test          # テスト
npm run build     # 型チェックと本番ビルド
```

Node.js 24 推奨（22.18 以上）。API キーは不要です。キーを使う場合は `app/.env.example` をもとに `app/.env` を作ります（コミットしない）。

- 公開（Cloud Run）: `app/scripts/deploy-cloudrun.sh`。手順は [app/docs/API_GUIDE.md](app/docs/API_GUIDE.md)
- Android（デバッグ APK）: `npm run apk`（JDK 21 と Android SDK 36）。GitHub Actions でも作ります
- 地図データの取り直し: `npm run data:osm`（GitHub Actions の「fetch osm data」でも実行できます）

## 使っている技術

| 用途 | 技術 |
| --- | --- |
| 公開 | **Cloud Run**（画面と API を同じサーバーから配信） |
| AI | **Gemini**（Vertex AI 経由。API キーがあれば AI Studio） |
| 健康データ（任意） | **Google Health API**（OAuth、サーバー内でのみトークンを保持） |
| 地図・天気（任意） | **Google Maps JavaScript API**、**Google Weather API**、Open-Meteo |
| 投稿の共有（任意） | **Firebase**（匿名認証・Firestore） |
| 画面 | React 19、Vite 8、three.js（3D 都市模型）、SunCalc v2、Capacitor 8（Android） |
| データ | OpenStreetMap（ODbL）、国土交通省 Project PLATEAU 横浜市 2024 |

空席の見込みは、時刻・曜日・天気・暑さ・周辺施設・投稿によるルール推定で、学習済みの AI や実測ではありません。日陰も計算モデルによる予測です。

## 開発期間前のコードの扱い（経緯）

このリポジトリには、開発開始（2026-11-05 10:00）より前の 2026-11-04 に作った試作のコードが、11-05 18:24 のコミット `427abb0`（「feat: add epoku app and team development handoff」）で取り込まれていました。また、同梱の地図データ（OpenStreetMap）は 11-04 に取得したものでした。

運営に申告し、締切までに差し替えれば審査対象になるとの回答を受け、2026-11-10 に次の対応をしました。

- **試作由来のコードはすべて削除しました。** `427abb0` で入った行を一度すべて外し、開発期間中に書いた部分（11-05 以降のコミット）だけを残したうえで、欠けた部分を 11-10 に新しく書き直しました。書き直しでは試作のコードを参照していません。手がかりにしたのは仕様書と、開発期間中に書いたコード・テストが求める関数や型の形です。
- **地図データは 11-10 に OpenStreetMap から取り直しました**（`app/public/data/area-osm.json`・`area-context.json`。取得時刻はファイル内の `fetchedAt` に記録）。
- **Android の雛形は 11-10 に Capacitor で作り直しました。** 設定ファイル・ドキュメントも同様に書き直すか削除しました。
- 試作のコードは Git の履歴（`427abb0` 以前の状態）には残っていますが、提出時点のファイルには含まれていません。差し替えの作業は Pull Request「11/4 の試作由来のコードを差し替える」にまとめています。
- `git blame` では、空行・`}` や、開発期間中のコードと合わせるために同じ名前になった型・関数の宣言など、短い行が `427abb0` に結び付いて表示されることがあります。内容は 11-10 に新しく書いたものです。

## 出典とライセンス

- 地図データ: © OpenStreetMap contributors（ODbL 1.0）
- 3D 建物: 国土交通省 Project PLATEAU 横浜市 2024 年度データを加工（[サイトポリシー](https://www.mlit.go.jp/plateau/site-policy/)）
- 天気: Open-Meteo（CC BY 4.0）、Google Weather API
- フォント: DM Sans、Noto Sans JP（Google Fonts、SIL OFL）
- 主なライブラリ: React、three.js、SunCalc、Capacitor、Firebase JS SDK、lucide-react（いずれも MIT / ISC / Apache-2.0）
