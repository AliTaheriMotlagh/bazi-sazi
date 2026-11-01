# ── 1. Build the studio + player (static files)
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/studio/package.json apps/studio/
RUN npm ci
COPY . .
RUN npm run build

# ── 2. Small runtime image: Node runs the TypeScript server directly (type stripping)
FROM node:24-alpine
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
WORKDIR /app/apps/server
COPY apps/server/package.json ./
RUN npm install --omit=dev --no-package-lock && npm cache clean --force
COPY apps/server/src ./src
# Dependency-free engine modules the server shares with the editor (collab, authoritative simulation).
COPY packages/engine/src/systems /app/packages/engine/src/systems
COPY --from=build /app/apps/studio/dist /app/apps/studio/dist
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "src/index.ts"]
