# Build local monorepo image (lightweight)
# docker build --no-cache -t flowise-lite .

# Run image
# docker run -d -p 3000:3000 -e LITE_MODE=true flowise-lite

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
    npm install -g pnpm

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_OPTIONS=--max-old-space-size=4096

WORKDIR /usr/src/flowise

COPY . .

RUN pnpm install && \
    pnpm build:docker

# ============================================
# Stage 2: Runtime (lightweight)
# ============================================
FROM node:20-alpine

RUN apk add --no-cache libc6-compat curl && \
    npm install -g pnpm

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_OPTIONS=--max-old-space-size=2048

WORKDIR /usr/src/flowise

# Copy built artifacts (node user can read these fine)
COPY --from=builder --chown=node:node /usr/src/flowise .

USER node

EXPOSE 3000

CMD [ "pnpm", "start" ]