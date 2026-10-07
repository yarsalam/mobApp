FROM node:20 AS builder

WORKDIR /app

# برای build sharp
RUN apt-get update && apt-get install -y \
  libvips-dev \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build


FROM node:20-slim AS runner

WORKDIR /app

# runtime dependency sharp
RUN apt-get update && apt-get install -y \
  libvips \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 5000

CMD ["node", "dist/main.js"]
