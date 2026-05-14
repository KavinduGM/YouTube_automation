# Multi-stage build. Same image is reused as api / worker / dashboard
# (different `command:` per service in docker-compose).

# ───────── Stage 1: install deps ─────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy only manifests first so Docker can cache the install layer.
COPY package.json package-lock.json tsconfig.base.json ./
COPY prisma ./prisma
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/dashboard/package.json ./apps/dashboard/

RUN npm ci --include=dev

# ───────── Stage 2: build everything ─────────
FROM deps AS builder
WORKDIR /app
COPY tsconfig.base.json ./
COPY prisma ./prisma
COPY packages ./packages
COPY apps ./apps
RUN npx prisma generate
RUN npm run build

# ───────── Stage 3: lean runtime ─────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    TMP_DIR=/app/tmp

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/tmp

# Bring in everything needed at runtime. node_modules contains the generated
# Prisma client (in node_modules/.prisma and node_modules/@prisma/client).
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps ./apps

EXPOSE 3000 4000

# Use tini so signals (SIGTERM from `docker stop`) reach the Node process cleanly.
ENTRYPOINT ["/usr/bin/tini", "--"]
# Default command — overridden per service in docker-compose.yml
CMD ["node", "apps/api/dist/index.js"]
