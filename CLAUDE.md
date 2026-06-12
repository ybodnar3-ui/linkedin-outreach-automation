# LinkedIn Outreach Automation — Project Guide

> Self-hosted аналог Dripify: автоматизація LinkedIn через **Chrome-розширення** (реальний браузер юзера) з React дашбордом.

---

## ⚠️ ARCHITECTURE REALITY (оновлено 2026-06-09, див. `.planning/decisions/ADR-001`)

**Розділи нижче місцями описують СТАРИЙ дизайн (серверний headless Playwright). Це більше не актуально.**

- **Виконавчий рушій — Chrome Extension** (`extension/`): працює в реальному браузері юзера (residential IP, жива сесія), виконує всі дії на LinkedIn. Найбезпечніший спосіб і єдиний, що реально працює.
- **Серверний headless Playwright — ВИДАЛЕНО** (ADR-001, Phase 1). Видалено `browser.ts`, `linkedin.ts`, скрейпери, `data/sessions/`; Playwright прибрано з `package.json` і Dockerfile. Datacenter-IP + headless = головний вектор бану, суперечив цілі «без бана».
- **Backend** = сервер координації + стан (SQLite) + дашборд + черга задач (`extension_tasks`). НЕ браузерна ферма.
- **Потік:** worker (cron 5хв) кладе задачі в `extension_tasks` → розширення поллить кожні 30с → виконує на LinkedIn → репортить результат → worker просуває крок ліда.
- **Worker — синглтон з cross-process lease-локом** (`worker_lock`): два процеси НІКОЛИ не виконують дії одночасно (= захист від подвійних дій = бана).
- **Чесна ціль:** не «закрий Mac», а «працює поки відкритий Chrome; backend у хмарі 24/7; дії — через реальний браузер».

---

## What This Is

Платформа для автоматизації LinkedIn-аутрічу. Запускає кампанії: відвідування профілю → connection request → повідомлення. Захищається від бану, бо діє через реальний браузер юзера. Керується через веб-дашборд.

**Не плутати з:** LinkedIn API (офіційного немає) — все через browser automation у Chrome-розширенні.

---

## Repo Structure

```
linkedin-automation/
├── backend/                    # Node.js + Express API сервер
│   └── src/
│       ├── index.ts            # Entry point, Express + WebSocket сервер
│       ├── routes/             # REST API handlers
│       │   ├── campaigns.ts    # CRUD + start/pause/resume
│       │   ├── leads.ts        # CRUD + CSV import
│       │   ├── analytics.ts    # Stats endpoints
│       │   └── settings.ts     # Account settings + LinkedIn login trigger
│       ├── services/
│       │   ├── linkedin.ts     # Playwright: всі дії (visit, connect, message)
│       │   ├── antiDetect.ts   # Конфіг браузера, fingerprint
│       │   ├── scheduler.ts    # node-cron: запускає campaign worker
│       │   ├── campaign.ts     # Логіка виконання кроків кампанії
│       │   └── storage.ts      # SQLite CRUD через better-sqlite3
│       ├── workers/
│       │   └── campaignWorker.ts # Головний цикл: обробляє активні кампанії
│       └── utils/
│           ├── delays.ts       # SAFE_LIMITS константи, DailyTracker
│           ├── humanizer.ts    # randomDelay, humanMouseMove, humanType, humanScroll
│           └── logger.ts       # winston logger
│   ├── data/
│   │   ├── campaigns.db        # SQLite база (або .json на ранніх стадіях)
│   │   └── sessions/           # LinkedIn cookies: {accountId}.json
│   └── logs/                   # YYYY-MM-DD.log файли (ротація 30 днів)
│
├── frontend/                   # React + Vite дашборд
│   └── src/
│       ├── pages/
│       │   ├── Dashboard.tsx   # Метрики + Live Activity log
│       │   ├── Campaigns.tsx   # Список кампаній
│       │   ├── CampaignBuilder.tsx # Drag-and-drop конструктор кроків
│       │   ├── Leads.tsx       # Таблиця лідів + CSV import
│       │   ├── Analytics.tsx   # Recharts графіки
│       │   └── Settings.tsx    # LinkedIn account + ліміти
│       ├── components/
│       │   ├── StepBuilder/    # @dnd-kit drag-and-drop кроки кампанії
│       │   ├── LeadTable/      # Таблиця з фільтрами та пагінацією
│       │   ├── StatusBadge/    # Кольорові статуси
│       │   ├── Charts/         # Recharts обгортки
│       │   └── LiveLog/        # WebSocket → real-time лог
│       └── hooks/
│           ├── useCampaigns.ts # React Query для кампаній
│           ├── useLeads.ts     # React Query для лідів
│           └── useLiveLog.ts   # WebSocket хук
│
├── .planning/                  # GSD planning docs (не видаляти)
│   ├── PROJECT.md              # Контекст проекту, рішення, обмеження
│   ├── REQUIREMENTS.md         # Вимоги з REQ-ID (LIN-01, ANT-01, ...)
│   ├── ROADMAP.md              # 3 фази, плани, критерії успіху
│   └── STATE.md                # Поточний прогрес
│
├── CLAUDE.md                   # Цей файл — читай першим
├── docker-compose.yml          # Локальний запуск
└── railway.toml                # Railway деплой конфіг
```

---

## Tech Stack

### Backend
| Технологія | Версія | Навіщо |
|------------|--------|--------|
| Node.js + TypeScript | 20 LTS | Основа |
| Express.js | 4.x | REST API |
| ~~Playwright~~ | — | **ВИДАЛЕНО** (ADR-001). Усі дії LinkedIn — через Chrome-розширення |
| better-sqlite3 | latest | Локальна БД (sync API). Версіоновані міграції (`schema_migrations`) + щоденні бекапи |
| node-cron | latest | Campaign worker (5 хв) + бекапи (03:00) |
| ws | latest | WebSocket для real-time логів |
| winston | latest | Логування у файли + console |
| multer + csv-parser | latest | CSV import |
| vitest | latest | Юніт-тести чистої логіки (`npm test`) |

### Frontend
| Технологія | Навіщо |
|------------|--------|
| React 18 + TypeScript + Vite | SPA дашборд |
| TailwindCSS | Стилі (темна тема) |
| Recharts | Графіки аналітики |
| @dnd-kit/core | Drag-and-drop конструктор кроків |
| React Query (TanStack Query) | API стан, кешування, refetch |
| React Router v6 | Навігація |
| Lucide React | Іконки |

### Infrastructure
- **Railway** — хостинг backend (координація + стан + дашборд)
- **Docker** — `node:20-bookworm-slim` (без Chromium/Playwright; лише build-tools для better-sqlite3)

---

## Critical: Anti-Detection Rules

> **Порушення цих правил = бан LinkedIn акаунта.** Перед будь-якими змінами в automation logic читай цей розділ.

### Денні ліміти (SAFE_LIMITS в delays.ts)

```typescript
const SAFE_LIMITS = {
  connectionRequestsPerDay: 20,   // НІКОЛИ не перевищувати
  messagesPerDay: 15,
  profileVisitsPerDay: 80,
  
  betweenActions: { min: 15_000, max: 45_000 },   // мс між діями
  betweenLeads:   { min: 60_000, max: 180_000 },  // мс між лідами
  betweenSessions:{ min: 3_600_000, max: 7_200_000 }, // мс між сесіями
  
  workingHours: { start: 9, end: 18 }, // не діяти вночі
  workingDays: [1, 2, 3, 4, 5],       // пн-пт тільки
}
```

### Humanizer принципи

- **Затримки**: Gaussian distribution, не `Math.random()` (uniform). Людина робить паузу "близько 5 секунд", а не "рівно від 3 до 7".
- **Мишка**: `humanMouseMove()` — рух по Bezier-кривій через 5-10 проміжних точок. Не телепорт через `.click()`.
- **Друк**: `humanType()` — посимвольно, 50-200ms/символ. Іноді помиляється і виправляє.
- **Скролінг**: `humanScroll()` — перед кожною дією скролити профіль, як людина що читає.
- **Viewport**: стабільний між сесіями, один з реалістичних розмірів (не 1920x1080).

### Warning Detection

Після кожної дії перевіряти `checkForWarnings(page)`:
- "Let's do a quick security check" → CAPTCHA
- "You've reached the weekly invitation limit" → зупинити кампанію
- "Your account has been restricted" → алерт, зупинити все
- Redirect на `/checkpoint/` → зупинити кампанію

### Прогрів акаунта

Перший тиждень: максимум 5-10 дій/день. Після ручного логіну — зачекати 30+ хвилин.

---

## Data Models

### Campaign

```typescript
interface Campaign {
  id: string
  name: string
  status: 'active' | 'paused' | 'completed' | 'error'
  steps: CampaignStep[]
  leads: string[]          // leadId масив
  settings: CampaignSettings
  stats: CampaignStats
  createdAt: string
  updatedAt: string
}

interface CampaignStep {
  id: string
  type: 'visit_profile' | 'send_connection' | 'send_message' | 'send_inmail' | 'wait'
  order: number
  config: {
    message?: string        // шаблон з {firstName}, {company}, тощо
    delayDays?: number      // для 'wait' кроку
    condition?: 'always' | 'if_connected' | 'if_not_replied'
  }
}

interface CampaignSettings {
  dailyConnectionLimit: number  // max 20
  dailyMessageLimit: number     // max 15
  workingHours: { start: number; end: number }
  workingDays: number[]
  timezone: string
}

interface CampaignStats {
  totalLeads: number
  profilesVisited: number
  connectionsSent: number
  connectionsAccepted: number
  messagesSent: number
  replies: number
  acceptanceRate: number  // %
  replyRate: number       // %
}
```

### Lead

```typescript
interface Lead {
  id: string
  campaignId: string
  firstName: string
  lastName: string
  company: string
  title: string
  profileUrl: string    // повинен бути linkedin.com/in/... URL
  
  status: 'pending' | 'visiting' | 'connection_sent' | 'connected' |
          'message_sent' | 'replied' | 'skipped' | 'error'
  currentStep: number
  
  visitedAt?: string
  connectionSentAt?: string
  connectedAt?: string
  messageSentAt?: string
  repliedAt?: string
  
  notes?: string
  tags?: string[]
  errorMessage?: string
}
```

### Log Entry

```typescript
interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'success'
  campaignId?: string
  leadId?: string
  action: 'visit_profile' | 'send_connection' | 'send_message' | 'check_connection' | 'warning' | 'limit_reached'
  message: string     // Human-readable: "✅ Visited profile: John Smith (Acme Corp)"
  metadata?: Record<string, any>
}
```

---

## REST API Reference

### Campaigns
```
GET    /api/campaigns              — список всіх кампаній
POST   /api/campaigns              — створити { name, steps, settings }
GET    /api/campaigns/:id          — деталі кампанії
PUT    /api/campaigns/:id          — оновити
DELETE /api/campaigns/:id          — видалити
POST   /api/campaigns/:id/start    — запустити (status → active)
POST   /api/campaigns/:id/pause    — призупинити (status → paused)
POST   /api/campaigns/:id/resume   — відновити (status → active)
GET    /api/campaigns/:id/stats    — CampaignStats об'єкт
```

### Leads
```
GET    /api/leads                  — список з query params: ?campaignId=&status=&search=&page=&limit=
POST   /api/leads/import           — multipart/form-data, поле: file (CSV)
POST   /api/leads                  — додати вручну { firstName, lastName, ... }
GET    /api/leads/:id              — деталі ліда
PUT    /api/leads/:id              — оновити
DELETE /api/leads/:id              — видалити
POST   /api/leads/:id/skip         — статус → skipped
```

### Analytics
```
GET    /api/analytics/overview         — { totalCampaigns, totalLeads, acceptanceRate, replyRate, ... }
GET    /api/analytics/daily?days=30    — [{ date, sent, accepted, messages, replies }]
GET    /api/analytics/campaign/:id     — детальна аналітика кампанії
```

### Settings
```
GET    /api/settings               — { limits, workingHours, workingDays, emailAlert }
PUT    /api/settings               — зберегти налаштування
POST   /api/settings/login         — ініціювати LinkedIn логін (відкрити headless: false браузер)
GET    /api/settings/session       — { status: 'active'|'expired'|'not_connected', lastChecked }
```

### WebSocket Events
```
ws://host/ws

Server → Client events:
  { type: 'log', data: LogEntry }
  { type: 'lead_update', data: { leadId, status, step, campaignId } }
  { type: 'stats_update', data: { campaignId, stats: CampaignStats } }
  { type: 'warning', data: { warningType: 'captcha'|'limit'|'restriction'|'checkpoint', message } }
```

---

## Campaign Worker Logic

```
campaignWorker.ts (запускається cron кожні 5 хв):

1. Отримати всі кампанії зі статусом 'active'
2. Для кожної кампанії:
   a. Перевірити workingHours і workingDays (поточний час в timezone кампанії)
   b. Перевірити DailyTracker: чи є ліміти на сьогодні
   c. Отримати наступного ліда зі статусом 'pending' або який чекає наступного кроку
   d. Визначити currentStep для цього ліда
   e. Виконати крок з урахуванням condition:
      - 'always' → виконати
      - 'if_connected' → перевірити статус, пропустити якщо не connected
      - 'if_not_replied' → пропустити якщо є repliedAt
   f. Оновити статус ліда і дату дії в БД
   g. Відправити lead_update і stats_update через WebSocket
   h. Зробити humanDelay (betweenLeads: 1-3 хв) перед наступним лідом

3. Окремо перевіряти лідів зі статусом 'connection_sent':
   - Якщо пройшло < 24 год → пропустити (чекати)
   - Якщо з'єднання прийнято → статус → 'connected', перейти до наступного кроку
   - Якщо пройшло > 14 днів → статус → 'skipped'
```

---

## CSV Import Format

```csv
firstName,lastName,company,title,profileUrl
John,Smith,Acme Corp,CEO,https://linkedin.com/in/johnsmith
Jane,Doe,Tech Inc,CTO,https://linkedin.com/in/janedoe
```

Валідація: `profileUrl` повинен відповідати pattern `https://linkedin.com/in/[a-zA-Z0-9-]+(/)?`

---

## Message Template Variables

```
{firstName}  — ім'я ліда
{lastName}   — прізвище ліда
{company}    — компанія ліда
{title}      — посада ліда
{myName}     — ім'я власника (з Settings)
```

Ліміти: connection note ≤300 символів, message ≤1900 символів.

---

## LinkedIn Session Flow

```
Перший запуск:
1. POST /api/settings/login → backend відкриває Playwright (headless: false)
2. Юзер бачить браузер, вручну вводить email + пароль LinkedIn
3. Backend чекає навігацію на /feed
4. Зберігає cookies + localStorage → data/sessions/default.json
5. Закриває видимий браузер

Наступні запуски:
1. Playwright стартує headless: true
2. Завантажує cookies з data/sessions/default.json
3. Переходить на /feed, перевіряє наявність навбару
4. Якщо навбар є → сесія активна ✓
5. Якщо немає → статус 'expired', WebSocket warning event, зупинити всі кампанії
```

---

## Deployment (Railway)

### backend/Dockerfile
```dockerfile
FROM mcr.microsoft.com/playwright:v1.44.0-jammy
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["node", "dist/index.js"]
```

### railway.toml
```toml
[build]
builder = "nixpacks"

[[services]]
name = "backend"
source = "backend/"

[[services]]
name = "frontend"
source = "frontend/"
```

### Environment Variables
```
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://your-frontend.railway.app
SESSION_SECRET=random-secret-key
```

---

## Design System

```
Тема: темна (dark mode)
Фон: #0f1117
Акцент: #2563eb (синій)
Sidebar: фіксований, ліворуч
Header: назва сторінки + LinkedIn session badge

Шрифти:
  UI: Geist Sans
  Числа і логи: Geist Mono

Статусні кольори:
  active/success: зелений (#16a34a)
  warning/paused: жовтий (#ca8a04)
  error/stopped: червоний (#dc2626)
  pending/neutral: сірий (#6b7280)

Компоненти:
  - Skeleton loaders при завантаженні
  - Toast notifications (успіх/помилка)
  - Modal форми (не inline editing)
  - Таблиці з пагінацією
```

---

## Development Phases

| Phase | Scope | Status |
|-------|-------|--------|
| **Phase 1: Core Backend** | Express + SQLite + Playwright + антидетект + REST API | Pending |
| **Phase 2: Frontend** | React дашборд + WebSocket + Campaign Builder | Pending |
| **Phase 3: Deploy** | Analytics + Railway деплой + production logging | Pending |
| **Phase 4: Extras** | Multi-account, proxy, webhooks, A/B тести | Future |

Детальний план: `.planning/ROADMAP.md`
Вимоги з REQ-ID: `.planning/REQUIREMENTS.md`

---

## Key Warnings for LLMs

1. **Не змінюй SAFE_LIMITS без явної команди користувача.** 20 connections/день — це межа безпеки.
2. **Усі дії на LinkedIn — через Chrome-розширення** (`extension/content.js`), НЕ через серверний Playwright. Playwright-шлях видаляється (ADR-001).
3. **Виконання працює, лише поки відкритий Chrome юзера** з розширенням. Backend сам по собі дії на LinkedIn не виконує.
4. **Сесія LinkedIn = жива сесія в Chrome юзера.** `data/sessions/` (cookie-файли Playwright) — legacy, видаляється разом з Playwright.
5. **WebSocket events** надсилаються після кожної зміни статусу ліда — фронтенд залежить від цього.
6. **Campaign worker** — синглтон. Захищений in-process прапором + cross-process lease-локом (`worker_lock` у БД). Два інстанси не виконають дії одночасно, але все одно не запускай кілька навмисно.
7. **better-sqlite3 — синхронний API** — не потрібен `await`. Не плутай з `sqlite3` (async).
8. **Після зміни `extension/*.js` — перезавантаж розширення** в `chrome://extensions` (інакше старий код).
9. **Backend dev = `npm run dev` (`tsx watch`).** Якщо запущений як голий `tsx` без watch — правки коду НЕ застосовуються до рестарту.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**LinkedIn Outreach Automation Platform**

Self-hosted платформа автоматизації LinkedIn-аутрічу — аналог Dripify. Дозволяє запускати кампанії послідовних дій (відвідування профілю → запит на з'єднання → повідомлення) з хмарним виконанням 24/7, захистом від бану через імітацію людської поведінки і повноцінним веб-дашбордом для керування всіма процесами.

**Для кого:** Власники бізнесу, сейлзи, рекрутери — всі хто хоче масштабувати LinkedIn-аутріч без ризику бану і без щомісячної підписки на Dripify ($59-149/міс).

**Core Value:** Безпечне виконання LinkedIn-кампаній 24/7 — система повинна надсилати connection requests і повідомлення без бану акаунта.

### Constraints

- **LinkedIn API:** Немає офіційного API — тільки Playwright browser automation
- **Ліміти:** Жорсткі денні ліміти, порушення = бан акаунта
- **Сесія:** Cookies зберігаються локально в `data/sessions/`, не в БД
- **Railway + Playwright:** Потребує спеціального Docker image `mcr.microsoft.com/playwright:v1.44.0-jammy`
- **Масштаб:** Один акаунт LinkedIn на інстанцію (multi-account — фаза 4)
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->
## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
