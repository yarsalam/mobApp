FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Native build dependency for sharp.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libvips-dev \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build
# Keep development/test packages out of the runtime image.
RUN npm prune --omit=dev --legacy-peer-deps

FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production
ENV PORT=5000
WORKDIR /app

# Runtime shared library for sharp only; no compiler/build toolchain in this stage.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libvips42 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/public \
  && chown node:node /app /app/public

COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 5000

CMD ["node", "dist/main.js"]
