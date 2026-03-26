FROM node:22-bookworm-slim AS base

# Install build dependencies for native modules (better-sqlite3, node-pty)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Copy source
COPY . .

# Build
RUN npm run build

# Production image
FROM node:22-bookworm-slim AS runner

RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built app and node_modules (need native modules)
COPY --from=base /app/.next ./.next
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./
COPY --from=base /app/public ./public
COPY --from=base /app/next.config.ts ./

# Create data directory for SQLite
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/boardroom.db
# Set NEXT_PUBLIC_APP_URL at runtime via docker-compose or -e flag (empty = relative URLs)
ENV NEXT_PUBLIC_APP_URL=

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["npm", "start"]
