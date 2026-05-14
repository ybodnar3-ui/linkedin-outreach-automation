FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# Install Node deps (ignore native addons — build separately below)
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm install --ignore-scripts

# Build native addon (better-sqlite3) inside the container where it can compile
RUN npm rebuild better-sqlite3 --update-binary || npm rebuild better-sqlite3

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
