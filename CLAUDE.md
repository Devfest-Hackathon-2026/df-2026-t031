# CLAUDE.md — epoku（学生向け休憩スポットAIマップ）

Claude Code がこのリポジトリで作業するときの前提。人間向けの詳細は `README.md`・`docs/TEAM_HANDOFF.md`・`docs/mvp.md`・`app/README.md`。

## プロジェクト
- DevFest GDGoC Japan Hackathon 2026 のチーム開発用リポジトリ（運営の公式提出リポジトリとは別。公式側へ push しない）
- アプリ本体は `app/`：React 19 + Vite 8 + Three.js（3D都市模型）+ SunCalc v2 + Capacitor 8（Android）
- **APIキーなしで全機能が動くこと**がチームの方針。外部APIは任意接続で、失敗時はデモ／同梱データに戻す
- デモエリアは横浜・みなとみらい（OSM同梱データ：256地点・建物1,274件・樹木2,425本）

## コマンド（`app/` で実行）
- `npm ci --ignore-scripts` 依存関係
- `npm run dev` 画面だけ（http://127.0.0.1:5188/）、`npm run dev:all` ローカルAPI込み
- `npm test` テスト（vitest）、`npm run build` 型チェック＋本番ビルド
- `npm run apk` デバッグAPK（JDK 21＋Android SDK 36。macOS の手順は `app/README.md`）
- GitHub Actions（`.github/workflows/ci.yml`）でもデバッグAPKを作り、Artifacts の `epoku-debug-apk` に置く

## コードの書き方
- 既存ファイルの書き方（1行に詰めた TSX、日本語のコメント・UI文言）に合わせる
- 計算は `src/domain/`（テストを `tests/` に足す）、画面は `src/App.tsx` と `src/components/`、配色は `src/immersive.css`
- 保存形式は `src/lib/storage.ts` の `validateSaved` を通す。項目を足すときは古いバックアップも読めるようにする
- `.env`・秘密鍵・署名鍵・`local.properties` はコミットしない
- 作業はブランチで行い、main へ直接コミットしない。PR に確認した内容と未確認事項を書く

## デザインの方向（ブランチ feature/sunlitt-ui-shadespot）
- 見た目は太陽追跡アプリ Sunlitt を参考にする：明るいベージュの建物・明るい緑・水色の水面・ピンクがかった空、濃い灰色のすりガラスのパネル、黄色い日時計カード、地図上の日時計リング（目盛り・赤い北の印・日の出は橙／日の入りは青灰の方向線・中心の白い石柱）、端の時刻／日付ピル
- 機能は日陰スポット探しのプロトタイプ SHADE SPOT を参考にする：日陰の3段階（日陰の可能性高／一部日陰／日なた）、ゴミ箱・回収場所の「捨てられる物」、ユーザー投稿・未検証の表示、通報（3件で非表示）
- 元アプリの名前・アイコン・画像はそのまま使わない（雰囲気を参考にするだけ）
- FocusFlight 風の集中タイマーは今回の範囲外

## このブランチで済んでいること
- 太陽パネル：日時計カード（`SunDialCard.tsx`）、時間帯を Sunlitt と同じ区切りで表示（青い時間 -6°〜-4°、黄金時間 -4°〜+6°、最後の光、太陽の真夜中、昼夜の長さ）
- 3D地図：Sunlitt 風の日時計と配色（`CityMap.tsx`・`cityGeometry.ts`）
- 端の時刻／日付ピルと「今」ボタン（`EdgeScrubbers.tsx`、PC幅のみ）、場所ピル（現在地・場所名・…メニュー）
- 日陰の3段階 `ShadeEngine.coverageAtXY`（中心と周囲1.5mの5点）を詳細と一覧に表示
- ゴミ箱の投稿（捨てられる物・利用条件・使えたか）、通報（`SpotFlag`、3件で一覧と地図から外す）
- 空席予測に暑さ指数の推定（`estimateWbgt`）を接続
- GitHub Actions の APK ジョブ、macOS のビルド手順、位置情報の権限
- テスト 38 件。検証記録は `app/docs/verification-3d.md`

## まだのこと（優先順）
1. Android 実機：APK を入れて、起動・3D・ピンチ／ドラッグ・端ピルのタッチ操作・現在地の許可・保存の保持を確認（GitHub Actions の APK ジョブも初回実行で確認）
2. スマホ幅の Sunlitt 風ボトムシート：太陽パネルを下から引き出す形にし、日時計カードを上に出す
3. アプリ内の徒歩ルート（現状は Google マップを開く。`docs/mvp.md` の M6）
4. 空席確率でピンを緑／黄／赤に色分け、「座れそう」「トイレ近く」の絞り込み（M3・M5）
5. 夜・夕方の空と建物の色（夜は濃紺、夕方は橙寄り）を Sunlitt に寄せる
6. 投稿・通報のチーム共有（Firebase。ルールはエミュレーターで確認してから）
