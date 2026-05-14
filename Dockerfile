FROM node:20-bookworm-slim

# Install system dependencies for Playwright/Chromium
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 libpangocairo-1.0-0 \
    libx11-xcb1 libxcb-dri3-0 wget ca-certificates \
    python3 make g++ \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node deps (ignore scripts first so better-sqlite3 can be rebuilt)
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm install --ignore-scripts

# Build native addon (better-sqlite3)
RUN npm rebuild better-sqlite3 --update-binary || npm rebuild better-sqlite3

# Install Playwright + Chromium browser binaries
RUN npx playwright install chromium

# Copy source
COPY . .

# Build frontend → backend/public
RUN npm run build --workspace=frontend

# Build backend
RUN npm run build --workspace=backend

# Runtime data directories
RUN mkdir -p data/sessions data/uploads data/logs

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "backend/dist/index.js"]
