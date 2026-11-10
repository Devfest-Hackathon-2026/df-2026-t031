#!/usr/bin/env bash
# epoku を Cloud Run へデプロイする（app/ で実行）。手順と前提は docs/API_GUIDE.md の「Cloud Run」
#   PROJECT=my-project ./scripts/deploy-cloudrun.sh
# 秘密情報は Secret Manager から渡す（同名のシークレットがあるものだけ）。.env の値はイメージに入れない
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-asia-northeast1}"
SERVICE="${SERVICE:-epoku}"
[ -n "$PROJECT" ] || { echo "PROJECT を指定してください（例: PROJECT=my-project $0）" >&2; exit 1; }
G=(--project "$PROJECT" --region "$REGION")

# 画面の公開設定（VITE_*）だけをビルド用に書き出す。同じオリジンで配るので VITE_API_BASE_URL は外す
BUILD_ENV=.env.production.local
trap 'rm -f "$BUILD_ENV"' EXIT
: > "$BUILD_ENV"
[ -f .env ] && grep -E '^VITE_' .env | grep -v '^VITE_API_BASE_URL=' >> "$BUILD_ENV" || true
echo "画面に埋め込む設定: $(cut -d= -f1 "$BUILD_ENV" | tr '\n' ' ')"

# 公開URL。サービスに PUBLIC_ORIGIN（独自ドメインなど）があればそれを保つ。無ければ決まった形の URL（https://SERVICE-プロジェクト番号.REGION.run.app）を使う
# status.url は古い形（…-an.a.run.app）を返すことがあり、そちらに合わせると共有している URL が 403 になるので使わない
service_url(){
  gcloud run services describe "$SERVICE" "${G[@]}" --format=json 2>/dev/null | node -e '
let d;try{d=JSON.parse(require("fs").readFileSync(0,"utf8"))}catch{process.exit()}
const env=Object.fromEntries((d.spec.template.spec.containers[0].env||[]).map(e=>[e.name,e.value]))
const urls=JSON.parse(d.metadata.annotations?.["run.googleapis.com/urls"]||"[]")
console.log(env.PUBLIC_ORIGIN||urls[0]||d.status?.url||"")'
}
URL="$(service_url || true)"

SECRETS=()
for name in GEMINI_API_KEY GOOGLE_WEATHER_API_KEY GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET; do
  if gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then SECRETS+=("$name=$name:latest"); fi
done
# Gemini は Secret Manager に GEMINI_API_KEY があればそれを、無ければ Vertex AI（実行サービスアカウントで認証）を使う
ENVS="GEMINI_MODEL=${GEMINI_MODEL:-gemini-3.8-flash},GEMINI_HOURLY_LIMIT=${GEMINI_HOURLY_LIMIT:-300},GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_CLOUD_LOCATION=${GOOGLE_CLOUD_LOCATION:-global}"
[ -n "$URL" ] && ENVS="$ENVS,PUBLIC_ORIGIN=$URL"
SECRET_ARGS=()
[ ${#SECRETS[@]} -gt 0 ] && SECRET_ARGS=(--update-secrets "$(IFS=,; echo "${SECRETS[*]}")")
echo "Secret Manager から渡すもの: ${SECRETS[*]:-なし（APIキーなしのデモ動作）}"

# ログインのセッションはメモリに持つので 1 台で動かす（再起動でログアウトになる）
# 環境変数は上書きでなく追加・更新（サービスに直接置いた値は残る）
gcloud run deploy "$SERVICE" "${G[@]}" --source . --allow-unauthenticated \
  --max-instances=1 --memory=512Mi --update-env-vars "$ENVS" ${SECRET_ARGS[@]+"${SECRET_ARGS[@]}"}

if [ -z "$URL" ]; then
  URL="$(service_url)"
  gcloud run services update "$SERVICE" "${G[@]}" --update-env-vars "PUBLIC_ORIGIN=$URL"
fi
echo
echo "公開URL: $URL"
echo "Googleログインを使うなら OAuth クライアントの承認済みリダイレクトURIに登録: $URL/api/auth/google/callback"
