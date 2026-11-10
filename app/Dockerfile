# epoku を Cloud Run で動かすイメージ。画面（dist）と API を同じオリジンから配る
# 画面の公開設定（VITE_*）はビルド時に埋め込む：.env.production.local（scripts/deploy-cloudrun.sh が作る）
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# 実行時は npm 依存なし（server は node:* と src/domain だけを使う）
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/package.json ./
COPY --from=build /app/server ./server
COPY --from=build /app/src/domain ./src/domain
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node","server/index.ts"]
