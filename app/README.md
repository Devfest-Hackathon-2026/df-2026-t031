# epoku — 休憩スポットマップ

既存の `src/domain` とOSMスナップショットを使い、画面・保存・API接続・Android化を追加したMVPです。キーなしの初期状態で動きます。

## v0.2 — 全画面3D探索

全画面の都市模型に、半透明の情報パネル、太陽のアーチ、動く影、時間再生を重ねたUIです。初期表示は新港中央広場を中心とした横浜のOSMモデルです。

- Three.jsのWebGL表示。ドラッグで回転、右ドラッグで移動、ホイール・ピンチで拡大縮小。
- 時刻スライダー、再生、日の出・南中・日の入りの時刻選択が同じ太陽位置へ連動。
- 左パネルに太陽の方位・高度と、建物の高さに対する影の長さを表示。
- 建物・樹木に落ちる影、実際の道路・歩道の同梱データ、太陽軌道の表示切替。
- 「探索」と「休憩スポット」のパネルを切替。投稿・お気に入り・追加地点の保存形式は維持。
- WebGLが使えない場合は2Dへ切替。3Dライブラリーは遅延読込し、樹木はインスタンス、建物は結合して描画。

形状と高さはOSMの模型です。窓や樹冠の細部・色は表示用の表現で、実際の外観を再現したものではありません。3Dの影はGPUシャドウマップ、地点の日陰判定は既存の光線計算を使います。表示範囲と解像度によって境界がずれることがあります。太陽の時刻はJSTです。表示天気は取得を選ぶまでデモです。

## 起動

Node.js 24推奨（22.18以上）。クローンしたら app/ で依存関係をインストールしてください。

```powershell
git clone https://github.com/kaito-0827/google-hackathon.git
cd google-hackathon/app
npm ci
npm run dev:all
```

Web: http://127.0.0.1:5188/ 。API: http://127.0.0.1:8787/ 。画面だけなら `npm run dev`。設定なしのAPIは未接続と表示します。ポートを分けたのは、別アプリが使っていた5173番のサービスワーカーとの衝突を避けるためです。

## 実装した操作

- 休憩スポット・トイレ・ゴミ箱・水飲み場の検索、距離・日陰・屋根・お気に入りの絞り込み
- OSM建物・樹木・公園の2D/3Dモデル地図、拡大縮小とドラッグ、選択地点の表示
- 日本時間での日付・時刻スライダー、日陰の時間帯、日の出・日の入り
- 空席のルール推定と根拠、実投稿の別表示、投稿の取消
- 地図からの地点追加と削除、お気に入り、JSONバックアップと復元
- Google Mapsへの徒歩ルートリンク。表示する徒歩分数は直線距離からの目安
- 初期読込後のオフライン再訪用サービスワーカー、PWAマニフェスト
- Google 2D/写実的3D、OSMライブ、Open-Meteo、Google Weather、Gemini、Firebaseの任意接続

初期状態の保存先はブラウザーのlocalStorageです。サイトデータを消すと失われます。地図データは256地点、建物1,274件、樹木2,425本のOSMスナップショットです。地点は実データですが、設備の営業状況・現地の存在を保証するものではありません。

## API追加

`.env.example` を `.env` にコピーし、必要な項目だけ設定して開発サーバーを再起動します。詳細は [API_GUIDE.md](docs/API_GUIDE.md) を参照してください。

| 接続 | 設定と操作 |
|---|---|
| Google 2D / 写実的3D | 設定画面にブラウザー用Mapsキーを入力して接続。環境変数も可 |
| Open-Meteo | 設定画面の取得ボタン。キー不要、ネットワークは必要 |
| OSM Overpass | 設定画面のライブ取得ボタン。未接続でも同梱データで動作 |
| Gemini | サーバーの `GEMINI_API_KEY`, `GEMINI_MODEL`。予測の理由欄から説明を依頼 |
| Google Weather | サーバーの `GOOGLE_WEATHER_API_KEY`。設定画面から取得 |
| Firebase | `VITE_FIREBASE_CONFIG`、匿名認証、同梱Firestoreルール。設定画面で共有開始 |

秘密鍵に `VITE_` を付けないでください。Maps・Firebaseの公開設定はブラウザーへ渡ります。Firebase共有は有効にした後の新規投稿だけが対象です。

Sites/Firebase Hostingへ `dist` を置いた静的Web版では、Node APIは動きません。Google Maps・Open-Meteo・OSMライブはブラウザーから接続できます。GeminiとGoogle Weatherはローカルの `npm run dev:all` で使う構成です。インターネット公開用APIサーバーの認証・CORS・利用制限は別途必要です。

## 予測の意味

空席確率は学習済みAIではありません。時刻・平休日・天気・周辺施設・席数・任意の架空イベントを入力とするルール v0で、現地観測による校正は未実施です。数値は参考値です。Geminiは数値を計算せず、与えられた根拠の説明だけに使います。

実投稿は別表示し、現在の15分前〜30分後の予測にのみ補正として使います。90分より古い投稿は除外し、20分で重みを半減させます。日陰はSunCalc v2（度・北起点）の太陽位置とOSM建物の高さを使います。建物は角柱、樹木は樹冠の円柱近似です。高さ不明の建物は仮定値を使い、画面内で件数を確認できます。地形・季節による葉の変化は未反映です。

長い影について、既存コードでは判定上限が1,500m・描画上限が1,200mに分かれていました。同じ定数1,500mを参照するよう修正し、回帰テストを追加しました。

## Android APK

Androidプロジェクトを同梱しています。JDK 21とAndroid SDK 36が必要です。

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio1\jbr'
$env:ANDROID_HOME = 'C:\Users\kouta\AppData\Local\Android\Sdk'
npm run apk
```

出力: `android/app/build/outputs/apk/debug/app-debug.apk`。デバッグ署名の開発用ビルドです。ストア公開用署名は含みません。Android実機での起動・位置情報権限・ファイル保存の確認は別途必要です。

## 検証

```powershell
npm test
npm run build
npm run check:apis
```

テスト28件は、JST・太陽位置・3D座標・影の方向と描画・長い影の一致・道路の向き・メッシュの結合・投稿補正・不正なバックアップ・同梱データ・ローカルAPIの応答を検証します。実行結果とブラウザーで確認した操作は [verification-3d.md](docs/verification-3d.md) に記録します。実APIキーを使った接続、予測精度、Android実機は未検証です。

## 構成

`src/domain/`: 既存のデータ変換・日陰・空席計算。`src/App.tsx`: 探索画面と操作。`src/components/MapView.tsx`: オフラインモデル地図とGoogle切替。`src/lib/`: 永続化・天気・Google・Firebase。`server/`: ローカル開発用の秘密鍵API。`android/`: Capacitor Android。

データ帰属: [© OpenStreetMap contributors / ODbL](https://www.openstreetmap.org/copyright)。天気: [Open-Meteo / CC BY 4.0](https://open-meteo.com/)。太陽計算: [SunCalc](https://github.com/mourner/suncalc)。Googleの地図形状を取得・解析する処理は含みません。
