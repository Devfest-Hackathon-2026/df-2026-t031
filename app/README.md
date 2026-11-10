# Rest Care（app）

2026-11-10 に書き直し。全体の説明はリポジトリ直下の [README](../README.md) を参照してください。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm ci --ignore-scripts` | 依存関係を入れる |
| `npm run dev` | 画面だけ（http://127.0.0.1:5188/） |
| `npm run dev:all` | 画面とローカル API（`server/index.ts`、:8787） |
| `npm test` | テスト（vitest） |
| `npm run build` | 型チェック・本番ビルド・オフライン用の `sw.js` |
| `npm run data:osm` | 同梱の地図データを OpenStreetMap から取り直す |
| `npm run apk` | Android のデバッグ APK（JDK 21・Android SDK 36） |
| `PROJECT=... ./scripts/deploy-cloudrun.sh` | Cloud Run へ公開（[docs/API_GUIDE.md](docs/API_GUIDE.md)） |

## フォルダ

- `src/domain/` 計算（座標・時刻・太陽・日陰・空席・暑さ・休憩の判断・経路）。テストは `tests/`
- `src/components/` 画面の部品（2D 地図・3D 都市模型・太陽パネル・休憩シート）
- `src/lib/` 保存・天気・Google マップ・共有・API の接続先
- `server/` ローカル API と公開用サーバー（Gemini・Google Weather・Google ログイン／Health）
- `public/data/` 同梱データ（OpenStreetMap 2026-11-10 取得、PLATEAU 横浜市 2024）

## macOS で APK を作る

```bash
brew install --cask temurin@21 android-commandlinetools
sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools"
export ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools"
npm run apk
```
