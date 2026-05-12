# Requirements: LinkedIn Outreach Automation Platform

**Defined:** 2026-05-12
**Core Value:** Безпечне виконання LinkedIn-кампаній 24/7 без бану акаунта

---

## v1 Requirements

### LinkedIn Automation (Core)

- [ ] **LIN-01**: Система відвідує LinkedIn-профіль ліда через Playwright
- [ ] **LIN-02**: Система надсилає connection request (з опційною note ≤300 символів)
- [ ] **LIN-03**: Система надсилає повідомлення підключеному ліду
- [ ] **LIN-04**: Система перевіряє статус з'єднання (accepted / pending / rejected)
- [ ] **LIN-05**: Перший логін — ручний (headless: false, юзер вводить credentials)
- [ ] **LIN-06**: Система зберігає cookies і відновлює сесію без повторного логіну
- [ ] **LIN-07**: Система виявляє протухання сесії і сигналізує про необхідність ре-логіну

### Anti-Detection

- [ ] **ANT-01**: Затримки між діями з Gaussian distribution (не uniform random)
- [ ] **ANT-02**: Симуляція руху миші через Bezier-криві (не телепорт до елемента)
- [ ] **ANT-03**: Посимвольний ввід тексту з варіативною швидкістю (50-200ms/символ)
- [ ] **ANT-04**: Іноді "помилятися" при друці і виправляти (1-2 рази на довге повідомлення)
- [ ] **ANT-05**: Скролінг сторінки перед кожною дією (читання профілю)
- [ ] **ANT-06**: Рандомний viewport з реалістичних розмірів (1366x768, 1440x900, 1536x864, 1280x800)
- [ ] **ANT-07**: Стабільний fingerprint браузера між сесіями (той самий viewport, userAgent, timezone)
- [ ] **ANT-08**: Денні ліміти: ≤20 connection requests, ≤15 повідомлень, ≤80 відвідувань профілів
- [ ] **ANT-09**: Робочий час 09:00-18:00 пн-пт (не діяти вночі і у вихідні)
- [ ] **ANT-10**: Паузи між лідами: 1-3 хвилини
- [ ] **ANT-11**: Паузи між сесіями: 1-2 години
- [ ] **ANT-12**: Трекер денних лімітів (скидається о 00:00)

### Warning Detection

- [ ] **WRN-01**: Детектор CAPTCHA ("Let's do a quick security check")
- [ ] **WRN-02**: Детектор ліміту запрошень ("You've reached the weekly invitation limit")
- [ ] **WRN-03**: Детектор блокування акаунта ("Your account has been restricted")
- [ ] **WRN-04**: Детектор редіректу на /checkpoint/
- [ ] **WRN-05**: При виявленні попередження — зупинити кампанію і записати алерт

### Campaigns

- [ ] **CMP-01**: CRUD кампаній (create, read, update, delete)
- [ ] **CMP-02**: Кампанія містить послідовні кроки: visit_profile, send_connection, send_message, wait
- [ ] **CMP-03**: Кожен крок має умову: always / if_connected / if_not_replied
- [ ] **CMP-04**: Кроки можна переставляти drag-and-drop у конструкторі
- [ ] **CMP-05**: Кампанія має налаштування: денні ліміти, робочий час, timezone
- [ ] **CMP-06**: Запуск / пауза / відновлення кампанії
- [ ] **CMP-07**: Статистика кампанії: sent / accepted / replied / acceptance rate / reply rate
- [ ] **CMP-08**: Воркер обробляє кампанії кожні 5 хвилин через cron

### Leads

- [ ] **LED-01**: CRUD лідів (firstName, lastName, company, title, profileUrl)
- [ ] **LED-02**: Імпорт лідів з CSV з прев'ю і маппінгом колонок
- [ ] **LED-03**: Валідація CSV: profileUrl повинен бути валідним LinkedIn URL
- [ ] **LED-04**: Дедублікація при імпорті (не додавати вже існуючих)
- [ ] **LED-05**: Статус ліда: pending / visiting / connection_sent / connected / message_sent / replied / skipped / error
- [ ] **LED-06**: Трекінг дат дій: visitedAt, connectionSentAt, connectedAt, messageSentAt, repliedAt
- [ ] **LED-07**: Пропуск ліда (skip) вручну
- [ ] **LED-08**: Фільтрація лідів за кампанією, статусом, датою
- [ ] **LED-09**: Пошук по лідах
- [ ] **LED-10**: Експорт лідів у CSV

### Message Templates

- [ ] **TPL-01**: Шаблони з персоналізацією: {firstName}, {lastName}, {company}, {title}, {myName}
- [ ] **TPL-02**: Connection note: ліміт 300 символів з лічильником
- [ ] **TPL-03**: Повідомлення: ліміт 1900 символів з лічильником
- [ ] **TPL-04**: Превью персоналізованого повідомлення для конкретного ліда

### REST API

- [ ] **API-01**: GET/POST/PUT/DELETE /api/campaigns
- [ ] **API-02**: POST /api/campaigns/:id/start|pause|resume
- [ ] **API-03**: GET /api/campaigns/:id/stats
- [ ] **API-04**: GET/POST/PUT/DELETE /api/leads + фільтри
- [ ] **API-05**: POST /api/leads/import (CSV upload)
- [ ] **API-06**: GET /api/analytics/overview|daily|campaign/:id
- [ ] **API-07**: GET/PUT /api/settings
- [ ] **API-08**: POST /api/settings/login (ініціювати LinkedIn логін)
- [ ] **API-09**: GET /api/settings/session (статус сесії)

### WebSocket

- [ ] **WSS-01**: WebSocket endpoint ws://host/ws
- [ ] **WSS-02**: Event `log`: { timestamp, level, message, campaignId }
- [ ] **WSS-03**: Event `lead_update`: { leadId, status, step }
- [ ] **WSS-04**: Event `stats_update`: { campaignId, stats }
- [ ] **WSS-05**: Event `warning`: { type, message } — CAPTCHA, ліміт, помилка

### Frontend Dashboard

- [ ] **FE-01**: Dashboard: метрики (active campaigns, connections today, acceptance rate, reply rate)
- [ ] **FE-02**: Dashboard: графік активності за 7/30 днів (Recharts LineChart)
- [ ] **FE-03**: Dashboard: Live Activity — real-time лог через WebSocket
- [ ] **FE-04**: Dashboard: статус LinkedIn сесії (зелений/червоний індикатор)
- [ ] **FE-05**: Dashboard: кнопка паузи всіх кампаній
- [ ] **FE-06**: Campaigns: список карток зі статусом і міні-статистикою
- [ ] **FE-07**: Campaign Builder: drag-and-drop конструктор кроків з вертикальним flow
- [ ] **FE-08**: Campaign Builder: налаштування кампанії (ліміти, робочий час, timezone)
- [ ] **FE-09**: Leads: таблиця з фільтрами, пошуком, пагінацією
- [ ] **FE-10**: Leads: імпорт CSV з прев'ю і результатом
- [ ] **FE-11**: Analytics: LineChart connections/accepted/messages/replies по днях
- [ ] **FE-12**: Analytics: BarChart порівняння кампаній
- [ ] **FE-13**: Settings: підключення LinkedIn акаунта через UI
- [ ] **FE-14**: Settings: глобальні ліміти і розклад
- [ ] **FE-15**: Темна тема (#0f1117 фон, #2563eb акцент), sidebar навігація

### Infrastructure

- [ ] **INF-01**: Dockerfile з Playwright base image для Railway деплою
- [ ] **INF-02**: docker-compose.yml для локального запуску
- [ ] **INF-03**: railway.toml конфіг для деплою backend + frontend
- [ ] **INF-04**: Логування у файли logs/YYYY-MM-DD.log з ротацією 30 днів
- [ ] **INF-05**: SQLite база даних (campaigns, leads, daily_tracker, logs)

---

## v2 Requirements

### Multi-Account

- **MAC-01**: Підтримка кількох LinkedIn акаунтів в одній інстанції
- **MAC-02**: Розподіл лідів між акаунтами
- **MAC-03**: Окремі ліміти і сесії для кожного акаунта

### Proxies

- **PRX-01**: Інтеграція residential proxy для захисту акаунта
- **PRX-02**: Прив'язка проксі до конкретного акаунта
- **PRX-03**: Перевірка здоров'я проксі

### Advanced Features

- **ADV-01**: Webhooks — відправляти події в Slack/Telegram
- **ADV-02**: A/B тестування шаблонів повідомлень
- **ADV-03**: Email-аутріч паралельно з LinkedIn

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-account підтримка | Фаза 4 — після стабільного MVP |
| Residential proxy | Фаза 4 — складність без гарантованої потреби |
| Email-аутріч | Окрема вертикаль, не LinkedIn-specific |
| A/B тестування | Post-MVP аналітична функція |
| Webhooks | Post-MVP інтеграційна функція |
| Мобільна адаптивність | Desktop-first за ТЗ |
| OAuth / кілька юзерів | Self-hosted — один власник |
| LinkedIn Sales Navigator специфіка | Базова автоматизація вперед |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| LIN-01..07 | Phase 1 | Pending |
| ANT-01..12 | Phase 1 | Pending |
| WRN-01..05 | Phase 1 | Pending |
| CMP-01..08 | Phase 1 | Pending |
| LED-01..10 | Phase 1 | Pending |
| TPL-01..04 | Phase 1 | Pending |
| API-01..09 | Phase 1 | Pending |
| WSS-01..05 | Phase 2 | Pending |
| FE-01..05 | Phase 2 | Pending |
| FE-06..08 | Phase 2 | Pending |
| FE-09..10 | Phase 2 | Pending |
| FE-11..12 | Phase 3 | Pending |
| FE-13..15 | Phase 2 | Pending |
| INF-01..05 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 55 total
- Mapped to phases: 55
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-12*
*Last updated: 2026-05-12 after initialization from ТЗ document*
