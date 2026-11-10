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

`.env` に `GEMINI_API_KEY` と `GEMINI_MODEL` を設定します。キーの代わりに Vertex AI も使えます：`GOOGLE_CLOUD_PROJECT`（と任意で `GOOGLE_CLOUD_LOCATION`、既定 `global`）を置くと、Cloud Run の実行サービスアカウントで認証して呼びます（キー不要。ローカルでは使えないので `GEMINI_API_KEY` を使う）。両方あれば `GEMINI_API_KEY` が優先です。`GEMINI_HOURLY_LIMIT` を置くと、サーバー全体の 1 時間あたりの呼び出し回数を絞ります（超えると 429）。モデル名は利用できる公式モデルに合わせて変更できます。`npm run dev:all` を起動し、スポットの「予測の理由を見る」内から依頼します。入力はスポットの表示名・推定済み確率・計算の根拠だけです。正確な端末現在地・投稿者情報は送りません。

Node APIはループバックだけで待ち受け、Host/Originを制限し、本文サイズ・入力型・簡易レート制限・タイムアウトを設けています。公開インターネット用の認証付きバックエンドとしては設計していません。

公式: https://aistudio.google.com/api-reference/generate-content

## Googleログイン・Google Health（休憩判断・任意）

休憩シート（ヘッダーの「休憩する」）は手入力とデモ値だけで動きます。Google Health の値を使うときだけ設定します。

1. Google Cloud で Google Health API を有効にし、OAuth 同意画面（外部・テスト）を作る。開発中はテストユーザーに使う Google アカウントを追加する。
2. 認証情報で「ウェブアプリケーション」の OAuth クライアントを作り、承認済みリダイレクト URI に `http://127.0.0.1:5188/api/auth/google/callback` を登録する（別ポート・別ホストならそれに合わせる）。
3. `app/.env` に `GOOGLE_OAUTH_CLIENT_ID` と `GOOGLE_OAUTH_CLIENT_SECRET` を置き、`npm run dev:all` を起動する。リダイレクト URI を固定したいときは `GOOGLE_OAUTH_REDIRECT_URI` を使う。

- 読む範囲は利用者が休憩シートで選んだ項目だけです：`googlehealth.activity_and_fitness.readonly`（歩数・活動時間）、`googlehealth.sleep.readonly`（睡眠）、`googlehealth.health_metrics_and_measurements.readonly`（心拍）。加えて `openid profile`。
- 認可コードは PKCE と state で受け、トークンはサーバーのメモリだけに置きます（`epoku_sid` の HttpOnly Cookie、最長 8 時間、再起動で消える）。ブラウザーと端末には渡しません。健康データの値も保存しません。
- 画面へ返すのは当日の集計値（歩数・活動分・昨夜の睡眠時間）と、心拍の区分（平常／やや高め／高め）だけです。心拍の時系列や位置は返しません。
- Gemini のひと言に健康データを使うのは、利用者が同意したときだけです。サーバー側でも許可リスト（`sanitizeRestContext`）で知らない項目と同意なしの健康データを捨て、診断・熱中症・病院・電話番号の表現は固定文に差し替えます。
- コールバックは `/?health=connected` などへ戻すため、画面と API が同じオリジンにある前提です（開発時は Vite の `/api` プロキシ、公開時は下の Cloud Run で同じサーバーが画面も配る）。APK や別ホストの静的配信からは今のところ使えません。
- テスト状態の OAuth アプリはリフレッシュトークンが 7 日で失効します。Google Health 側でデータ連携が済んでいないアカウントは `linked:false`（ACCOUNT_NOT_LINKED）として「データなし」を表示します。
- 実際の Google アカウントでの通し確認と、各データ型のレスポンス項目名（歩数の `count`、睡眠の `minutesAsleep` など）の実データ照合はまだです。項目名は公式リファレンスに合わせて実装し、読めない場合は値を入れずに手入力へ戻します。

公式: https://developers.google.com/health/setup 、https://developers.google.com/health/scopes 、https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list

## Cloud Run（公開）

`app/server/` が画面（`dist`）と API を同じオリジンから配ります。`PUBLIC_ORIGIN` を置くとそのホストだけを受け付け、Cookie に `Secure` が付き、OAuth のリダイレクト URI もそこから作ります。置かなければ従来どおりローカル専用（127.0.0.1 / localhost）です。

1. 使う Google Cloud プロジェクトで Cloud Run・Cloud Build・Artifact Registry・Secret Manager の API を有効にする。デプロイする人に Cloud Run 管理者・Cloud Build 編集者・サービスアカウントユーザー・Secret Manager 管理者（または同等）の権限が要る。
2. Gemini は Vertex AI で呼ぶのが既定（スクリプトが `GOOGLE_CLOUD_PROJECT`・`GOOGLE_CLOUD_LOCATION=global`・`GEMINI_HOURLY_LIMIT=300` を置く）。Vertex AI API を有効にし、実行サービスアカウントに「Vertex AI ユーザー」を付ける。
3. 秘密情報は Secret Manager に**同じ名前**で入れる（使うものだけ）。`GEMINI_API_KEY`・`GOOGLE_WEATHER_API_KEY`・`GOOGLE_OAUTH_CLIENT_ID`・`GOOGLE_OAUTH_CLIENT_SECRET`。Cloud Run の実行サービスアカウント（既定は Compute Engine のデフォルト）に「Secret Manager のシークレット アクセサー」を付ける。

```bash
printf %s "$GEMINI_API_KEY" | gcloud secrets create GEMINI_API_KEY --data-file=- --project=PROJECT
```

4. `app/` で `PROJECT=PROJECT ./scripts/deploy-cloudrun.sh`（リージョン既定 `asia-northeast1`、サービス名既定 `epoku`。`REGION`・`SERVICE` で変えられる）。
   - `.env` の `VITE_*`（Maps・Firebase の公開設定）だけを `.env.production.local` に書き出して画面に埋め込み、終わったら消す。`VITE_API_BASE_URL` は同じオリジンなので外す。秘密情報はイメージに入らない（`.dockerignore`・`.gcloudignore`）。
   - Secret Manager に無いシークレットは渡さない。キーなしでもデモ動作する。
   - 環境変数は追加・更新だけで、サービスに直接置いた値（例：`GOOGLE_WEATHER_API_KEY`）は消さない。同じ名前をシークレットに移すときは、先に `gcloud run services update --remove-env-vars` で外す。
   - 初回はデプロイ後に URL が決まるので、そのまま `PUBLIC_ORIGIN` を設定して 2 回目のリビジョンを作る。URL は `https://SERVICE-プロジェクト番号.REGION.run.app` の形を使う（もう一つの `…-an.a.run.app` は 403 になる）。サービスに `PUBLIC_ORIGIN` が既にあればそれを保つ。
5. Googleログインを使うなら、OAuth クライアントの承認済みリダイレクト URI に `https://<サービスのURL>/api/auth/google/callback` を足す。Maps のキーの HTTP リファラー制限にもサービスの URL を足す。

- ログインのセッションはサーバーのメモリにあるので `--max-instances=1` で動かす。再起動・新しいリビジョン・アイドルからの起動でログアウトになる。人数を増やすときは Firestore などにセッションを移す。
- 回数制限（1 分 12 回）は `X-Forwarded-For` の末尾（Google の前段が足した接続元）で数える。実際の Cloud Run 上での値はまだ確かめていない。
- 独自ドメインを付けたら `PUBLIC_ORIGIN` をそのドメインに変え、リダイレクト URI も合わせる（`*.run.app` からは 403 になる）。
- ローカルでイメージを試す：`docker build -t epoku-local . && docker run --rm -p 8080:8080 -e PUBLIC_ORIGIN=http://localhost:8080 epoku-local` → http://localhost:8080/

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
