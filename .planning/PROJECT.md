# LinkedIn Outreach Automation Platform

## What This Is

Self-hosted платформа автоматизації LinkedIn-аутрічу — аналог Dripify. Дозволяє запускати кампанії послідовних дій (відвідування профілю → запит на з'єднання → повідомлення) з хмарним виконанням 24/7, захистом від бану через імітацію людської поведінки і повноцінним веб-дашбордом для керування всіма процесами.

**Для кого:** Власники бізнесу, сейлзи, рекрутери — всі хто хоче масштабувати LinkedIn-аутріч без ризику бану і без щомісячної підписки на Dripify ($59-149/міс).

## Core Value

Безпечне виконання LinkedIn-кампаній 24/7 — система повинна надсилати connection requests і повідомлення без бану акаунта.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Playwright-автоматизація LinkedIn (відвідування, з'єднання, повідомлення)
- [ ] Антидетект: людська поведінка, денні ліміти, рандомні затримки
- [ ] Збереження та відновлення LinkedIn-сесії через cookies
- [ ] CRUD кампаній з drag-and-drop конструктором кроків
- [ ] Управління базою лідів з імпортом CSV
- [ ] Real-time лог дій через WebSocket
- [ ] Dashboard з метриками і графіками аналітики
- [ ] REST API для всіх операцій
- [ ] Детектор попереджень LinkedIn (CAPTCHA, ліміти, блокування)
- [ ] Деплой на Railway з Playwright підтримкою

### Out of Scope

- Multi-account підтримка — фаза 4, після MVP
- Residential proxy інтеграція — фаза 4, додає складність
- Email-аутріч — окрема продуктова вертикаль
- A/B тестування шаблонів — пост-MVP
- Webhooks (Slack/Telegram) — фаза 4
- Мобільна адаптивність — desktop-first за ТЗ

## Context

### Технічний контекст

- **Backend:** Node.js + TypeScript + Express + Playwright (Chromium) + better-sqlite3 + node-cron + ws + winston
- **Frontend:** React + TypeScript + Vite + TailwindCSS + Recharts + @dnd-kit/core + React Query + React Router + Lucide React
- **Інфраструктура:** Railway (хостинг), Docker з Playwright base image
- **Дані:** SQLite (надійніше JSON, простіше PostgreSQL для self-hosted)

### Безпека (критично)

LinkedIn активно банить неприродну поведінку. Ключові обмеження:
- Максимум **20** connection requests/день (не 25!)
- Паузи між діями: 15-45 сек
- Паузи між лідами: 1-3 хв
- Паузи між сесіями: 1-2 год
- Робочі години: 09:00-18:00, пн-пт
- **Перший тиждень — режим прогріву:** 5-10 дій/день
- Після ручного логіну чекати 30+ хвилин перед автоматизацією

### Аутентифікація LinkedIn

Перший логін — ручний (headless: false), система зберігає cookies. Подальші запуски — headless: true з відновленням сесії. При протуханні сесії — алерт власнику.

### Дизайн

Темна тема, фон #0f1117, акцент #2563eb, шрифти Geist Sans / Geist Mono для логів і чисел.

## Constraints

- **LinkedIn API:** Немає офіційного API — тільки Playwright browser automation
- **Ліміти:** Жорсткі денні ліміти, порушення = бан акаунта
- **Сесія:** Cookies зберігаються локально в `data/sessions/`, не в БД
- **Railway + Playwright:** Потребує спеціального Docker image `mcr.microsoft.com/playwright:v1.44.0-jammy`
- **Масштаб:** Один акаунт LinkedIn на інстанцію (multi-account — фаза 4)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| better-sqlite3 замість JSON | Надійніше за flat files, простіше за PostgreSQL для self-hosted | — Pending |
| Playwright замість LinkedIn API | Офіційного API немає, Puppeteer менш стабільний | — Pending |
| WebSocket для live logs | Real-time UX без polling overhead | — Pending |
| Railway для деплою | Підтримує Playwright Docker, простий CI/CD | — Pending |
| React Query для стану | Кешування + optimistic updates + refetch логіка | — Pending |
| @dnd-kit замість react-beautiful-dnd | Підтримується, accessible, гнучкий | — Pending |
| Gaussian distribution для затримок | Реалістичніше за uniform random — людська поведінка | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-12 after initialization from ТЗ document*
