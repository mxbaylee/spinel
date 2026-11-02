FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Workspace manifests (lib/<name>/) must be in place before npm ci links them.
# One line per package: COPY of a glob flattens the directories.
COPY lib/diagnostics/package.json ./lib/diagnostics/package.json
COPY lib/doc-formulas/package.json ./lib/doc-formulas/package.json
COPY lib/presence-ui/package.json ./lib/presence-ui/package.json
COPY lib/print/package.json ./lib/print/package.json
COPY lib/sync-transform/package.json ./lib/sync-transform/package.json
COPY lib/sync-server/package.json ./lib/sync-server/package.json
COPY lib/sync-client/package.json ./lib/sync-client/package.json
COPY scripts/dependencies ./scripts/dependencies
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev && mkdir -p src

FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9
ENV NODE_ENV=production HOST=127.0.0.1 PORT=3000 DATABASE_PATH=/data/spinel.sqlite
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/lib ./lib
# The complete workspace copy above includes lib/print's manifest and source.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/scripts/deploy ./scripts/deploy
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "--max-old-space-size=256", "--max-semi-space-size=8", "server/index.ts"]
