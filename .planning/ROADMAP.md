# Roadmap: LinkedIn Outreach Automation Platform

**Created:** 2026-05-12
**Phases:** 4 | **Requirements:** 80 | **Mode:** Vertical MVP

---

## Overview

| # | Phase | Goal | Requirements | Status |
|---|-------|------|--------------|--------|
| 1 | Core Backend | Playwright + антидетект + API + БД | LIN, ANT, WRN, CMP, LED, TPL, API, INF | Complete |
| 2 | Frontend Dashboard | React дашборд + WebSocket | FE-01..15, WSS-01..05 | Complete |
| 3 | Polish & Deploy | Аналітика + Railway деплой + production-ready | FE-11..12, INF-01..03 | Complete |
| 4 | Advanced Features | Smart Inbox + A/B + Multi-account + Branches + Email Discovery | ADV-01..25 | Complete |

---

## Phase 1: Core Backend

**Goal:** Повністю функціональний backend — Playwright автоматизація LinkedIn, антидетект система, REST API, SQLite БД. Можна запускати кампанії через curl/Postman.
**Mode:** mvp

**Requirements:** LIN-01..07, ANT-01..12, WRN-01..05, CMP-01..08, LED-01..10, TPL-01..04, API-01..09, INF-04..05

**Success Criteria:**
1. Система відвідує LinkedIn-профіль, надсилає connection request і повідомлення без ручного втручання
2. Денні ліміти дотримуються: не більше 20 connection requests, зупинка після досягнення
3. CAPTCHA і попередження LinkedIn виявляються і зупиняють кампанію
4. Сесія зберігається між перезапусками сервера (cookies відновлюються)
5. CSV з лідами імпортується, дублікати пропускаються, помилкові URL відхиляються
6. REST API повертає коректні дані для всіх endpoints

**Plans:**

### Plan 1.1: Project Setup + Database
- Ініціалізація TypeScript monorepo (backend/ + frontend/)
- Express сервер з базовою конфігурацією
- better-sqlite3 схема: campaigns, leads, daily_tracker, sessions, logs
- Storage service: CRUD операції поверх SQLite
- Logger (winston): файлові логи + console output

### Plan 1.2: LinkedIn Service + Session Management
- Playwright browser factory з антидетект конфігурацією (viewport, userAgent, timezone)
- Ручний логін flow (headless: false, очікування поки юзер залогінився)
- Збереження/відновлення cookies з `data/sessions/{accountId}.json`
- Перевірка активності сесії (navigate to /feed, check navbar)
- Fingerprint persistence між сесіями

### Plan 1.3: Anti-Detection Engine
- `humanizer.ts`: Gaussian delay, human mouse move (Bezier), human type (per-char з помилками), human scroll
- `delays.ts`: всі константи затримок і лімітів
- `limits.ts`: DailyTracker з reset о 00:00, перевірка робочих годин і днів
- Warning detector: CAPTCHA, invitation limit, account restriction, /checkpoint/ redirect

### Plan 1.4: Campaign Worker + Actions
- LinkedIn actions: visitProfile, sendConnection, sendMessage, checkConnectionStatus
- Template engine: підстановка {firstName}, {lastName}, {company}, {title}, {myName}
- Campaign worker: cron кожні 5 хвилин, обробка черги лідів
- Step executor: логіка умов (if_connected, if_not_replied), wait step
- Connection acceptance checker: 24h polling, 14-day skip

### Plan 1.5: REST API Routes
- `/api/campaigns` — повний CRUD + start/pause/resume/stats
- `/api/leads` — CRUD + import CSV (multer) + skip + фільтри
- `/api/analytics` — overview, daily, campaign-specific
- `/api/settings` — get/put + login trigger + session status
- Error handling middleware, input validation

---

## Phase 2: Frontend Dashboard

**Goal:** Повноцінний React дашборд з real-time моніторингом через WebSocket. Можна керувати всіма кампаніями через UI без curl.
**Mode:** mvp

**Requirements:** FE-01..15, WSS-01..05

**Success Criteria:**
1. Dashboard показує живі метрики і live log оновлюється в реальному часі
2. Нова кампанія створюється через drag-and-drop конструктор і запускається з UI
3. CSV імпортується з прев'ю — видно скільки додано/пропущено/помилок
4. Статус LinkedIn сесії відображається (зелений/червоний)
5. Зміна статусу ліда в воркері одразу відображається в таблиці лідів

**Plans:**

### Plan 2.1: WebSocket Server + React Base
- WebSocket server (`ws` library) на backend — events: log, lead_update, stats_update, warning
- React + Vite + TypeScript setup з TailwindCSS
- React Router: маршрути для Dashboard, Campaigns, Leads, Analytics, Settings
- Base layout: sidebar навігація + header + main content
- React Query setup з axios client

### Plan 2.2: Dashboard Page
- Метрика-картки: active campaigns, connections today, acceptance rate, reply rate
- LineChart (Recharts): active connections по днях — 7d / 30d toggle
- Live Activity: WebSocket `log` events → scrollable log компонент (рівень, час, повідомлення)
- LinkedIn session badge: зелений (active) / червоний (expired/error)
- Emergency pause button: POST /api/campaigns/pause-all

### Plan 2.3: Campaign Builder
- Campaigns list: картки зі статусом, міні-статистикою, play/pause/edit/delete кнопками
- Campaign Builder form: назва, налаштування (ліміти, робочий час, timezone)
- StepBuilder: drag-and-drop (@dnd-kit) вертикальний flow кроків
  - Visit Profile step
  - Send Connection step (textarea для note, лічильник 300)
  - Send Message step (textarea, лічильник 1900, змінні {firstName} тощо)
  - Wait N days step
  - Умова кожного кроку: always / if_connected / if_not_replied
- Зберегти / Зберегти і запустити

### Plan 2.4: Leads + Settings Pages
- Leads таблиця: колонки Name, Company, Title, Campaign, Status, Last Action, Date
- Фільтри: campaign, status, date range; пошук; пагінація
- CSV import modal: upload → прев'ю 5 рядків → confirm → результат (added/skipped/errors)
- Ручне додавання ліда: modal форма
- Експорт CSV кнопка
- Settings: session status + "Connect Account" button → POST /api/settings/login
- Settings: глобальні ліміти (слайдери + чекбокси робочих днів)

---

## Phase 3: Polish & Deploy

**Goal:** Production-ready деплой на Railway з повною аналітикою і логуванням.
**Mode:** mvp

**Requirements:** FE-11..12, INF-01..03

**Success Criteria:**
1. Застосунок задеплоєний на Railway і доступний за публічним URL
2. Playwright запускається headless в Railway контейнері
3. Analytics показує коректні графіки за реальними даними
4. Логи ротуються і зберігаються 30 днів

**Plans:**

### Plan 3.1: Analytics Page
- Overview stats: загальний acceptance rate, reply rate, total sent/connected/replied
- LineChart: connections sent / accepted / messages / replies по днях
- BarChart: порівняння ефективності кампаній (acceptance rate % per campaign)
- Топ-кампаній таблиця з сортуванням
- Date range picker для фільтрації

### Plan 3.2: Railway Deployment
- `backend/Dockerfile` з `mcr.microsoft.com/playwright:v1.44.0-jammy` base image
- `docker-compose.yml` для локального розробки (backend + frontend hot reload)
- `railway.toml` конфіг: backend service + frontend service
- Environment variables: NODE_ENV, PORT, FRONTEND_URL, SESSION_SECRET
- Frontend build: Vite production build, статичні файли через backend або окремий Railway service
- Log rotation: winston daily rotate file transport (30 днів)
- Health check endpoint: GET /api/health

---

## Phase 4: Advanced Features

**Goal:** Розширення платформи: Smart Inbox, A/B тестування, мульти-акаунт, умовні гілки в кампаніях, Email Discovery.
**Mode:** mvp

**Requirements:** ADV-01..25

**Plans:** 7 plans

**Success Criteria:**
1. Smart Inbox показує всі LinkedIn-переписки і дозволяє відповідати з дашборду
2. A/B тест запускається для message step: 2 варіанти тексту, система рандомно роздає, показує winner по reply rate
3. 2+ LinkedIn акаунти можна додати і призначити кожному кампанії — запускаються паралельно
4. Campaign builder підтримує гілки: "Якщо прийняв" → дія A, "Якщо не прийняв через 7 днів" → дія B
5. Email Discovery знаходить email по LinkedIn URL через Hunter.io/Apollo API і зберігає в lead профілі

Plans:
- [ ] 04-01-PLAN.md — Database Schema Migration (accounts, inbox_messages, ab_tests, campaign_steps branches, leads email)
- [ ] 04-02-PLAN.md — Multi-Account Backend (AccountService, BrowserFactory, CampaignWorker multi-account, /api/accounts)
- [ ] 04-03-PLAN.md — Conditional Branches Engine (BranchResolver service, CampaignWorker branch routing)
- [ ] 04-04-PLAN.md — A/B Testing Engine (ABTestService, /api/ab-tests, CampaignWorker variant text selection)
- [ ] 04-05-PLAN.md — Smart Inbox (LinkedInInboxService, InboxPoller cron, /api/inbox)
- [ ] 04-06-PLAN.md — Email Discovery (Hunter.io + Apollo.io, /api/leads/:id/discover-email, settings API keys)
- [ ] 04-07-PLAN.md — Frontend Advanced UI (AccountsPage, InboxPage, CampaignBuilder branches/AB, LeadsPage email, AnalyticsPage AB results)

---

*Roadmap created: 2026-05-12*
*Updated: 2026-05-13 — Added Phase 4: Advanced Features*
*Updated: 2026-05-13 — Phase 4 plans finalized (7 plans, 3 waves)*
