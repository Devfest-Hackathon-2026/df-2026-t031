# 開発の進め方

2026-11-10 作成。

1. `main` に直接コミットせず、ブランチを作って Pull Request を出す。
2. `app/` で `npm test` と `npm run build` が通ることを確かめる（GitHub Actions でも同じことを実行する）。
3. Pull Request には、確認したことと、まだ確認していないことを書く。
4. `.env`・API キー・サービスアカウントの JSON・署名鍵はコミットしない。誤って公開したら、履歴を消すだけでなく、すぐにコンソールでキーを無効化する。
5. 計算は `app/src/domain/`（テストを `app/tests/` に足す）、画面は `app/src/App.tsx` と `app/src/components/` に置く。
