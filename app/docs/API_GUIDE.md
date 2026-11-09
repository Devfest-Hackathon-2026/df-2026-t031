# API接続ガイド

APIは必要なものだけ有効化してください。初期状態で外部APIのキーは不要です。

## Google Maps

1. Google CloudでMaps JavaScript APIを有効化し、請求設定と利用枠を確認する。
2. ブラウザー用キーを作成し、アプリのURL・localhostにHTTPリファラー制限を付け、利用APIを絞る。
3. アプリの設定にキーを入力し「Google 2Dに接続」または「Google 3Dに接続」を選ぶ。起動時の既定値は `VITE_GOOGLE_MAPS_API_KEY`。

3Dは `Map3DElement` と対話型マーカーを使用します。WebGL対応など端末条件があります。地図表示に失敗するとモデル地図へ戻ります。日陰の判定はGoogleの映像に依存しません。ブラウザーに読み込んだGoogle SDKのキーを変えるときはページを再読み込みしてから再接続してください。

公式: https://developers.google.com/maps/documentation/javascript/3d/marker-overview

## 天気

Open-Meteoは設定画面で任意取得します。取得した時間別予報の範囲内だけ使用し、範囲外の日付には「天気デモ」を表示します。天気APIの無料利用条件は用途に合わせて確認してください。

Google Weatherは `.env` に `GOOGLE_WEATHER_API_KEY` を置き、Weather APIを有効化。`npm run dev:all` でNode APIを立ち上げて取得ボタンを押します。対象エリア固定で24時間を取得し、10分キャッシュします。キーや上流エラー本文をクライアントに返しません。

公式: https://open-meteo.com/en/docs 、https://developers.google.com/maps/documentation/weather/hourly-forecast

## Gemini

`.env` に `GEMINI_API_KEY` と `GEMINI_MODEL` を設定します。モデル名は利用できる公式モデルに合わせて変更できます。`npm run dev:all` を起動し、スポットの「予測の理由を見る」内から依頼します。入力はスポットの表示名・推定済み確率・計算の根拠だけです。正確な端末現在地・投稿者情報は送りません。

Node APIはループバックだけで待ち受け、Host/Originを制限し、本文サイズ・入力型・簡易レート制限・タイムアウトを設けています。公開インターネット用の認証付きバックエンドとしては設計していません。

公式: https://aistudio.google.com/api-reference/generate-content

## Firebase

1. Firebaseプロジェクトを作成し、Authenticationの匿名ログインを有効化する。
2. Firestoreを作成し、このプロジェクトの `firestore.rules` を適用する。既存プロジェクトへ適用する場合は既存ルールと統合する。
3. Webアプリの公開設定を `.env` の `VITE_FIREBASE_CONFIG` に1行のJSONで置く。

```dotenv
VITE_FIREBASE_CONFIG={"apiKey":"公開キー","authDomain":"PROJECT.firebaseapp.com","projectId":"PROJECT","appId":"WEB_APP_ID"}
```

4. 開発サーバーを再起動し、設定から共有開始する。本番Web版は再ビルドする。

コレクションは `epokuReports`。1投稿には `id, spotId, value, ownerUid, createdAt` を保存し、作成時刻はサーバー時刻です。他人の投稿の変更・削除を拒否します。匿名ログインした利用者は直近250件を読み取れます。Firestoreルールと実プロジェクトによる動作確認はまだです。公開運用ではApp Check、スパム制限、データ保持期間、利用規約・同意をプロダクトに合わせて追加してください。

公式: https://firebase.google.com/docs/firestore/security/rules-conditions

## PLATEAU・精度改善

現在の日陰計算の入口は `Building[]` と `Tree[]` です。PLATEAUから変換した輪郭・高さを `AreaDataset.buildings` に渡せば、画面を変えずに利用できます。PLATEAU取得・変換自体は未実装です。空席予測は「モデル v1」です。

- ルールの確率（時間帯・曜日・天気・雨上がり・暑さ・暗さ・イベント・人通り・80m 以内のほかの座れる場所・席数）を、この端末の過去の「座れた／満席」投稿で地点ごとに補正します。投稿時の入力（時刻・曜日・気温・日陰・ルールの確率）を端末内だけに保存し、件数が少ないうちは補正を 0 に寄せます。
- 直近 90 分の投稿は、同じ地点に加えて 150m 以内の地点の投稿も距離に応じて弱めに反映します。
- 確からしさ（高／中／低と 80% の幅）は、仮定の多さと投稿量から出す目安で、実測で校正した値ではありません。
- 共有投稿（Firestore）には投稿時の入力を送らないため、他の人の投稿は直近の反映にだけ使われ、過去分の補正には使われません。
- 現地観測で正解データを集め、補正の効果と幅の校正を確かめる段階が残っています。
