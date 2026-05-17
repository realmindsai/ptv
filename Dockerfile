# syntax=docker/dockerfile:1.6

# ─── stage 1: build ──────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

RUN npm run build

# ─── stage 2: runtime ────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Install runtime deps only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output (includes templates + static-assets via build script).
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

EXPOSE 8080

# wget is in the base image; use it to ping the local healthz.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT}/healthz" >/dev/null || exit 1

# Use shell form so PORT/HOST env vars are interpolated.
CMD ["sh", "-c", "node dist/index.js serve --port \"$PORT\" --host \"$HOST\""]
