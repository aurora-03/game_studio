# Rebuild and test intentionally when upgrading these pinned runtimes.
ARG NODE_IMAGE=node:24.14.1-bookworm-slim
ARG CADDY_IMAGE=caddy:2.11.6-alpine@sha256:d44355d3c2149dc580ce2cac735955d1c08d3d00882c30489c241aa51a5c10d9

FROM ${CADDY_IMAGE} AS proxy
RUN mkdir -p /data/caddy /config/caddy && chown -R 1000:1000 /data /config
COPY --chown=1000:1000 deploy/Caddyfile /etc/caddy/Caddyfile
USER 1000:1000

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.* ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM ${NODE_IMAGE} AS app
ENV NODE_ENV=production
WORKDIR /app
RUN mkdir -p /var/lib/gamestudio /home/node/.codex && chown -R node:node /var/lib/gamestudio /home/node/.codex && chmod 0700 /var/lib/gamestudio /home/node/.codex
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node scripts/preflight-production.mjs ./scripts/preflight-production.mjs
COPY --chown=node:node deploy/entrypoint.sh ./deploy/entrypoint.sh
RUN chmod 0755 /app/deploy/entrypoint.sh
USER node
EXPOSE 4100
ENTRYPOINT ["/app/deploy/entrypoint.sh"]
CMD ["node", "server/index.js"]
