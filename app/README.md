# epoku — 休憩スポットAIマップ（アプリ本体）

<!-- 2026-11-10 期間内に書き直し。現在の構成（Vercel + Firebase + Google Cloud の API）に合わせた説明 -->

横浜駅西口周辺で「いま・着いたときに座れて、日陰で休める場所」を探すための Web アプリです。
ベンチや屋根付きの休憩所、トイレ・水飲み場などを地図に出し、太陽の位置と建物・樹木から日陰を、
時刻・天気・周りの状況・投稿から空席の見込みを出します。Android 版（Capacitor）も同じコードから作れます。

## 動かす

Node.js 22.18 以上（24 推奨）。このフォルダー（`app/`）で実行します。

```bash
npm ci
npm run dev:all   # 画面 http://127.0.0.1:5188/ と API http://127.0.0.1:8787/ を同時に起動
```

画面だけでよければ `npm run dev`。API キーを何も設定していなくても、同梱データと手動デモの天気で一通り動きます。
つながっていない外部サービスは画面上で「未接続」と表示します。

| コマンド | 内容 |
|---|---|
| `npm run dev` / `dev:server` / `dev:all` | 画面・API・両方の開発サーバー |
| `npm run build` | 型チェック → Vite ビルド → オフライン用 Service Worker 生成 |
| `npm run preview` | ビルド結果の確認 |
| `npm test` | vitest（146 件） |
| `npm run typecheck` | TypeScript の型チェックのみ |
| `npm run e2e` | Playwright によるスモーク確認（後述の既知の問題あり） |
| `npm run check:apis` | `.env` に入れたキーで外部 API に届くか確認 |
| `npm run data:osm` | OpenStreetMap から同梱データを取り直す |
| `npm run cap:sync` / `apk` | Android プロジェクトへの反映・デバッグ APK の作成 |

## 公開構成

| 役割 | 使うもの |
|---|---|
| 画面と API の配信 | Vercel（`vercel.json`。`scripts/vercel-output.mjs` が `/api/*` を 1 本の関数にまとめる） |
| 投稿の共有・匿名ログイン | Firebase（Authentication・Firestore。ルールは `firestore.rules`） |
| 外部 API | Google Cloud（Maps JavaScript / Weather / Gemini）。キーはすべてサーバー側の環境変数 |

Vercel に設定する環境変数とその意味は `.env.example` にまとめています。秘密の値に `VITE_` を付けると
ブラウザーに埋め込まれてしまうので付けないでください（Maps のブラウザー用キーと Firebase の公開設定だけは例外）。
キーの取り方と接続の詳細は [docs/API_GUIDE.md](docs/API_GUIDE.md) にあります。

API の入口は次のとおりです（`server/index.ts`）。

- `GET /api/health` — どの外部 API がつながっているか
- `POST /api/explain` — 空席の見込みや休憩の一言を Gemini が文章にする（数値の計算はしない）
- `GET /api/weather` — Google Weather の 24 時間予報（10 分キャッシュ）
- `/api/auth/*`, `/api/google-health/*` — Google Health 連携（任意、`server/googleHealth.ts`）

同じオリジン以外からの呼び出しは 403 で断ります。

## 日陰と空席の出し方

**日陰** — SunCalc で日本時間の太陽の方位・高度を求め、OSM の建物（角柱）と樹木（樹冠を円柱で近似）の影が
地点にかかるかを判定します。地図に描く影と判定には同じ最大距離を使います。地形や季節による葉の量は考えていません。

**空席** — 学習済みの AI モデルではなく、ルールベースの推定（`rule-v1`）です。時刻・平日/休日・天気と暑さ・
日陰・屋根・席数・周りの施設を入力にし、この端末に残った過去の投稿から時間帯ごとの傾向を少しずつ学びます。
直近の投稿は 20 分で重みが半分になり、古すぎる投稿は使いません。根拠は画面に表示します。現地での精度検証はまだです。

## データの保存

最初はブラウザーの localStorage（キー `epoku:v1`）だけに保存します。サイトデータを消すと消えるので、
設定画面から JSON でバックアップ・復元できます。Firebase の共有を有効にすると、その後の投稿だけが共有されます。

同梱の地図データは OSM のスナップショット（休憩関連 256 地点と周辺の建物・樹木・道路）と、
横浜市西区の一部を切り出した PLATEAU LOD2 の建物モデルです。実在の設備ですが、現地にいまもあること・使えることは保証しません。

## Android

JDK 21 と Android SDK 36 を用意して `npm run apk`。`android/app/build/outputs/apk/debug/app-debug.apk` に
デバッグ署名の APK（versionName 0.3.0）ができます。ストア公開用の署名は含みません。
APK から API を使うときは `VITE_API_BASE_URL` に公開 API の URL を入れてビルドします。

## 既知の問題・未確認のこと

- `npm run e2e` は、初期表示の「シンプル表示」で切り替えボタンが隠れているため、休憩スポット画面への切り替えの段階で止まります（main でも同じ）。
- 実際の Google API キー・Firebase プロジェクトを使った本番の接続、空席の見込みの精度、Android 実機での動作は未確認です。

## ファイルの場所

- `src/domain/` — 太陽・日陰・空席・経路など、画面に依存しない計算
- `src/components/`, `src/App.tsx` — 画面
- `src/lib/` — 保存・天気・地図・Firebase・API 呼び出し
- `server/` — API（開発時は Node、本番は Vercel の関数）
- `scripts/` — 開発・ビルド・データ取得の補助
- `tests/` — vitest、`e2e/` — Playwright のスモーク確認
- `android/` — Capacitor の Android プロジェクト

## 出典

地図データ © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)（ODbL）。
3D 建物 [PLATEAU](https://www.mlit.go.jp/plateau/)（国土交通省）。
天気 [Open-Meteo](https://open-meteo.com/)（CC BY 4.0）／Google Weather。太陽の位置 [SunCalc](https://github.com/mourner/suncalc)。
