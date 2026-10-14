# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────
#  Nuxt 4 (Nitro) · production image
#  build:  docker build -t honeypotforge-frontend .
#  run:    docker run -d -p 3000:3000 honeypotforge-frontend
# ─────────────────────────────────────────────────────────────

FROM node:22-alpine AS build

WORKDIR /app

ARG NUXT_APP_BASE_URL=/
ENV NUXT_APP_BASE_URL=${NUXT_APP_BASE_URL}

# кэш: слой с зависимостями пересобирается только при изменении lock-файла
COPY package.json package-lock.json ./
RUN npm ci

# исходники и сборка
COPY . .
RUN npm run build

# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    NITRO_PORT=3000 \
    NITRO_HOST=0.0.0.0

# self-contained серверный билд (.output содержит свой node_modules)
COPY --from=build /app/.output ./.output

RUN addgroup -S app && adduser -S app -G app \
    && chown -R app:app /app
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:3000${NUXT_APP_BASE_URL}" >/dev/null 2>&1 || exit 1

CMD ["node", ".output/server/index.mjs"]
