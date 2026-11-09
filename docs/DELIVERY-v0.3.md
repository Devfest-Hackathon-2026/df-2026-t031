# epoku v0.3 引き渡し（2026-11-06）

既存epokuを改善し、Web版とAndroid用デバッグAPKを更新しました。ソースは `feat/mobile-rest-explorer`、レビューは [PR #1](https://github.com/kaito-0827/google-hackathon/pull/1) です。mainへのマージはしていません。

## 使うもの

- [更新済みWeb版](https://epoku-rest-map-kouta.wakingdogwood.chatgpt.site/) — 同じURLのSites保存版3。閲覧範囲は従来の所有者向け設定を保持。
- Android: `epoku-v0.3.0-debug.apk`、5,390,612 bytes、開発用のデバッグ署名。
- アプリの実装元コミット: `76104116a4a1934e98ef10f519c903f8b139a674`。
- Sitesソース: `82deaadde201b5abf6077080f4cbbd3231277db4`。アプリのファイルを同じ状態で同期し、ビルドして公開。
- APK SHA-256: `5BE20825F135CE61E8323A2E4177D612028ABCAE6A5FDE48B4BEDD7303AEDD89`。

## 確認した結果

- [GitHub Actions](https://github.com/kaito-0827/google-hackathon/actions/runs/42041714145): 36テストとWebビルド成功。
- APKビルド成功。配布用コピーと、Android統合テストに使用したAPKのSHA-256が一致。
- 2026-11-06のAndroid 16 / API 36.1 / x86_64エミュレーターで統合テスト1件成功。[JUnit結果](verification/2026-11-06-android.xml)。
- 統合テストは、PLATEAUの同梱3D、シート、ネイティブ戻る操作、投稿、お気に入り、参考経路、再読込後の保存を確認。
- 長時間の中断を挟んだ検証はタイムアウトしたため成功に数えず、再開後に同じ最終APKで成功を確認。
- ブラウザーではスマホのシートのスワイプ、2D切替、検索、投稿保存、参考経路、日時変更、360/390/768pxの横はみ出しを確認。

## 開発再開

```bash
git clone https://github.com/kaito-0827/google-hackathon.git
cd google-hackathon
git switch feat/mobile-rest-explorer
cd app
npm ci
npm run dev:all
```

[スマホ・Androidの検証記録](../app/docs/verification-mobile.md) と [TEAM_HANDOFF.md](TEAM_HANDOFF.md) に、操作手順、再ビルド、担当分け、残作業を記録しています。

**残る確認:** 物理Android、iPhone Safari、物理端末の30FPSと長時間動作、外部API実接続・Firebase共有、現地の設備と日陰・空席の校正。参考経路の通行可否は未確認です。

Unreal Engineは使用していません。React / Three.js / CapacitorにPLATEAU横浜2024 LOD2の142棟を取り込んだ構成です。参考画像と同じ全域の都市データ・水域・ランドマークの密度には達していません。
