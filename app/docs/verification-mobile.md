# epoku v0.3 — スマホ・Android検証と引き継ぎ

確認日: 2026-11-05（JST）。既存のepokuを更新。別のデモアプリは作成していない。

## 変更した体験

- スマホは下部シートを3段階で開閉。ハンドルのスワイプ、ボタン、Androidの戻る操作に対応。
- 「座れそう」は投稿補正後の参考値70%以上。「トイレ近く」は掲載トイレから直線200m以内。営業・利用可能性は未確認。
- 3D/2Dピンを参考推定の緑・黄・赤で表示。非着席設備は別色。推定と実投稿は別枠。
- 天気・太陽高度からの暑さの参考指数を既存の空席ロジックへ接続。健康判断用の測定値・公的WBGTではない。
- 同梱OSM道路の接続からアプリ内に参考経路を表示。接続できない場合は「直線の目安・徒歩経路ではありません」と表示。
- スマホ初期値は軽量表示。画素比、影、樹木、建物の装飾、ぼかしを抑える。品質切替でもカメラ位置を保持。
- 太陽軌道を選択地点の地理座標に固定。日時と影、地点の日陰判定が連動する。
- PLATEAU横浜市2024年度・西区LOD2の142棟をオフラインで読み込む。重複するOSM建物を置き換え、対象外は従来のOSMを使用。
- Androidの位置情報権限を宣言。Capacitor標準の権限処理と、拒否・対象外時の既存フォールバックを使用。
- AndroidのセーフエリアはCapacitor 8の推奨native方式。APKから使う任意APIは公開HTTPS URLを指定できる。

## 検証結果

| 検証 | 結果 |
| --- | --- |
| `npm test` | 4ファイル・36件成功 |
| `npm run build` | TypeScript / Vite / SW生成に成功 |
| `npm run apk` | versionName 0.3.0 / versionCode 3、デバッグAPKを生成 |
| Android統合テスト | Android 16 / API 36.1、Medium_Phone_API_36.1、x86_64エミュレーターで1件成功 |
| 統合テストの内容 | 同梱PLATEAUの3D読込、シート開閉、Androidの戻る操作、投稿、お気に入り、参考経路、再読込後の保存 |
| ブラウザー | Chromiumで検索、空状態とリセット、投稿とお気に入りの再読込後の保存、参考経路、夜間表示、絞り込み |
| レイアウト | 390pxスマホ、360pxスマホ、768pxタブレット、1280pxデスクトップを確認。横スクロールは発生しなかった |
| 追加ロジック | 道路接続、非歩行道路の除外、接続不可時の明示、トイレ距離、空席閾値、PLATEAUのハッシュ・重複置換、暑さ×日陰をテスト |

AndroidテストはWebView内のDOM操作とネイティブの戻るハンドラーを組み合わせる統合テスト。物理端末の指による操作確認とは異なる。
最初の実行では、旧DOMを再読込完了と誤認するテスト競合が発生した。ネイティブのページ読込完了を待つよう修正し、同じ保存の検証を成功まで確認した。
起動時のSystem UI応答停止表示は、AVDの復元を使わずコールドブートして切り分けた。アプリのANRは記録されていなかった。

## 再現手順

```bash
cd app
npm ci
npm test
npm run build
npm run dev:all
```

通常の開発URLは http://127.0.0.1:5188/ 。他の作業と重複する場合は `npm run dev -- --port 5191 --strictPort` で起動できる。

JDK 21とAndroid SDK 36を設定して:

```bash
npm run apk
cd android
# macOS / Linux: ./gradlew
# Windows: gradlew.bat
./gradlew :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=jp.epoku.restmap.OfflineFlowTest
```

テスト前にエミュレーターまたは開発端末を接続する。生成APKは `android/app/build/outputs/apk/debug/app-debug.apk`。デバッグ署名であり、ストア配布用の署名は含まない。
Androidテスト結果: `android/app/build/reports/androidTests/connected/debug/index.html`。

## 2分以内の操作手順

1. キーなしで起動し、同梱の3D地図を回転・拡大する。
2. 時刻を昼から夕方に変更し、太陽・影と日陰の表示が変化することを見せる。
3. 「座れそう」「トイレ近く」で絞り込む。詳細シートを広げ、参考推定と最近の実投稿を分けて説明する。
4. 「ここへ行く」でアプリ内の参考経路を表示する。道路の接続・接続線・通行未確認の意味を説明する。
5. 「座れた」とお気に入りを登録し、再読込後も残ることを見せる。

## 性能の確認範囲

- 同梱道路グラフ: 7,739頂点。桜木町から新港中央広場付近の51点の参考経路を、開発PCのNodeで約6msで計算（以前の全頂点走査は約56ms）。端末の測定値ではない。
- PLATEAU GLB: 1,673,236 bytes、22,435三角形、142棟。端末上でCityGMLやDracoを変換しない。
- 樹木はインスタンス、OSM建物は結合。PLATEAU読込時に全都市を再生成せず、仮表示だけ置換する。
- 初回のエミュレーター起動計測は約6.6秒。AVD起動・WebView初期化を含む観測で、物理端末の起動時間ではない。
- **物理Androidでの30FPS達成、電池消費、長時間のメモリ安定性は未確認。** WebGLの描画統計は `.city-canvas` の `data-draw-calls` / `data-triangles` で開発者が読める。オンデマンド描画なので、静止時のフレーム数をFPS性能として解釈しない。

## 残りの確認

- 物理Androidで指の操作、位置情報の許可・拒否、縦横回転、文字拡大、長時間動作、30FPSの測定。
- iPhone Safari / ホーム画面追加 / オフライン再訪の実機確認。
- Gemini / Weather / Google Maps / Firebaseの実キー・実プロジェクトでの接続確認。現在の標準状態はキーなし・端末内保存。
- 歩道、出入口、立入制限、横断箇所を確認した徒歩経路。現在のグラフは通行可能性を保証しない。日陰優先経路も未実装。
- 日陰と空席の現地観察・校正、時間帯での設備の開放状況。空席率は学習済みAIではない。
- OSM同梱スナップショットの海岸・水域の不足を補うこと。現在の水域・道路は収録済みの部分のみで、参考画像の全域と同じ密度ではない。
- 掲載範囲外やPLATEAU未収録のランドマークの形状。装飾的な窓・樹木は実際の外観ではない。

## 技術選定

今回の実装はReact / Three.js / CapacitorにPLATEAUの変換済みデータを追加した構成。Unreal Engineは使用していない。
PLATEAU SDK for Unreal v3.2.2はUE 5.5.4想定、PCにはUE 5.7があり、同じ対応版での検証環境は揃っていなかった。Android/iOSのSDK機能は一部に限られる。UEのプロジェクト作成・モデル取込・APK性能測定は未実施。
今回は既存WebとAPKを共通の実装で更新できることを優先した。UEを採用し直す際は、対応版を揃えた別検証で都市の小範囲を取り込み、APKの実機描画、UMG UI、既存機能の移行量、Webの提供手段を比較する。

- [SDKの対応版](https://github.com/Project-PLATEAU/PLATEAU-SDK-for-Unreal/releases/tag/v3.2.2)
- [SDKのモバイル対応範囲](https://github.com/Project-PLATEAU/PLATEAU-SDK-for-Unreal#動作環境)
- [UEのライセンス条件](https://www.unrealengine.com/license)

## PLATEAU出典と変換

出典: [3D都市モデル（Project PLATEAU）横浜市（2024年度）](https://www.geospatial.jp/ckan/dataset/plateau-14100-yokohama-shi-2024)をepoku向けに加工。
[国土交通省PLATEAUサイトポリシー](https://www.mlit.go.jp/plateau/site-policy/)の第3項、公共データ利用規約に従い、出典・加工を表示する。CC BY 4.0と互換の利用も認められている。個別の注記と測量成果の利用条件は、用途を広げる際に再確認する。

`public/data/plateau-nishi.json` に年度、LOD、元タイルURLとSHA-256、GLBのSHA-256、建物の近似外周を記録。
`node scripts/prepare-plateau.mjs` で公式カタログから同じ年度・種類のタイルを取得し、Draco展開、座標変換、範囲抽出、GLB化を行う。外部公開データが更新された場合はハッシュ差分と件数をレビューする。
検証ブランチは `spike/plateau-2024`。アプリへの組込みは `feat/mobile-rest-explorer`。

地形は含めず、各建物の底面を地面に合わせる。日陰計算に使う凸包は、くぼみ・通路・張り出しを正確に表すものではない。実データの年度や収録範囲を超える正確さは主張しない。

OSMは[© OpenStreetMap contributors / ODbL](https://www.openstreetmap.org/copyright)。PLATEAUと原データのファイル・出典を分け、設備の存在・空席をPLATEAUから得た情報とは説明しない。

## 任意APIをAPKから使う

`app/.env` に `VITE_API_BASE_URL=https://...` を設定してビルドする。これは公開URLであり秘密鍵ではない。サーバー側に認証、許可するOrigin、利用制限を用意する。
未設定のAPKでlocalhostを開発PCと見なさない。基本機能は同梱データで動作し、Gemini等は未接続と表示する。
Sitesへ静的ファイルを置いただけではNode APIは起動しない。既存Webサイトの閲覧権限とGitHubリポジトリの共同開発権限は別で、今回どちらも拡大していない。
