FROM node:20-bookworm-slim

# Extension-only (ADR-001): no server-side browser. Only build tools for the
# better-sqlite3 native addon are needed — no Chromium / Playwright system libs.
RUN apt-get update && apt-get install -y \
    ca-certificates python3 make g++ \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node deps (ignore scripts first so better-sqlite3 can be rebuilt)
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm install --ignore-scripts

# Build native addon (better-sqlite3)
RUN npm rebuild better-sqlite3 --update-binary || npm rebuild better-sqlite3

# Copy source
COPY . .

# Build frontend → backend/public
RUN npm run build --workspace=frontend

# Build backend
RUN npm run build --workspace=backend

# Runtime data directories
RUN mkdir -p data/uploads data/logs

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "backend/dist/index.js"]
