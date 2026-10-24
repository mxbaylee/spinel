FROM node:26.11.1-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY lib/diagnostics/package.json ./lib/diagnostics/package.json
COPY lib/doc-formulas/package.json ./lib/doc-formulas/package.json
COPY lib/presence-ui/package.json ./lib/presence-ui/package.json
COPY scripts/dependencies ./scripts/dependencies
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev && mkdir -p src

FROM node:26.11.1-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567
ENV NODE_ENV=production HOST=127.0.0.1 PORT=3000 DATABASE_PATH=/data/spinel.sqlite
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/lib ./lib
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/scripts/deploy ./scripts/deploy
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "server/index.ts"]
