FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

COPY package.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm install --workspaces --include-workspace-root

COPY . .

RUN npm run build --workspace=frontend
RUN npm run build --workspace=backend

RUN mkdir -p data/sessions data/uploads data/logs

EXPOSE 3001

CMD ["node", "backend/dist/index.js"]
