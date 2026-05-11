# Build local monorepo image (lightweight)
# docker build --no-cache -t flowise-lite .

# Run image
# docker run -d -p 3000:3000 -e LITE_MODE=true -v flowise_data:/home/node/.flowise flowise-lite

# ============================================
# Stage 1: Build
# ============================================
FROM node:20-alpine AS builder

RUN apk update && \
    apk add --no-cache \
        libc6-compat \
        python3 \
        make \
        g++ \
        build-base \
        curl && \
    corepack enable && \
    corepack prepare pnpm@10.26.0 --activate

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV CI=true
ENV NODE_OPTIONS=--max-old-space-size=4096

WORKDIR /usr/src/flowise

# ── Layer-cache: copy dependency manifests first ──
# Changes to source code won't invalidate the expensive pnpm install layer
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY packages/server/package.json packages/server/package.json
COPY packages/components/package.json packages/components/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/api-documentation/package.json packages/api-documentation/package.json

RUN pnpm install --frozen-lockfile

# ── Now copy source and build ──
COPY . .
RUN pnpm build:docker && pnpm prune --prod --ignore-scripts && pnpm store prune

# ============================================
# Stage 2: Runtime (lightweight)
# ============================================
FROM node:20-alpine

RUN apk add --no-cache libc6-compat curl && \
    corepack enable && \
    corepack prepare pnpm@10.26.0 --activate

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production
ENV HOME=/home/node
ENV NODE_OPTIONS=--max-old-space-size=2048

WORKDIR /usr/src/flowise

# Copy built artifacts (node user can read these fine)
COPY --from=builder --chown=node:node /usr/src/flowise .

RUN mkdir -p /home/node/.flowise && chown -R node:node /home/node/.flowise

USER node

EXPOSE 3000

# Graceful shutdown: let Node handle SIGTERM properly
STOPSIGNAL SIGTERM
CMD [ "node", "packages/server/bin/run", "start" ]
