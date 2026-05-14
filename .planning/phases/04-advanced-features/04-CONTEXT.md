# Phase 4: Advanced Features - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning
**Source:** User requirements

<domain>
## Phase Boundary

Phase 4 додає 5 великих фіч поверх вже працюючої платформи (Phases 1-3 complete, deployed to Railway):
- Smart Inbox — читання/відповідь на LinkedIn повідомлення прямо з дашборду
- A/B Testing — тестування варіантів message templates, визначення winner
- Multi-Account — кілька LinkedIn акаунтів паралельно, кожен зі своїми кампаніями
- Conditional Branches — розгалуження в кампаніях (if accepted / if not replied)
- Email Discovery — автоматичний пошук email через Hunter.io / Apollo.io API

</domain>

<decisions>
## Implementation Decisions

### Architecture
- Existing stack: Node.js + TypeScript + Express + better-sqlite3 + Playwright + React + Vite + Tailwind
- Worktree: `/Users/yura.mac/linkedin-outreach-automation/linkedin-outreach-automation/.claude/worktrees/mystifying-kowalevski-2a5688/`
- All new features extend existing DB and API patterns

### Multi-Account
- Кожен акаунт: окремий Playwright browser instance, окрема сесія у `data/sessions/{accountId}.json`
- Нова таблиця `accounts` (id, name, email, status, session_file)
- Кампанії прив'язані до акаунту через `account_id` FK
- Worker запускає паралельні цикли (по одному воркеру на активний акаунт)
- UI: AccountsPage зі статусом і Connect кнопкою для кожного

### Conditional Branches
- Типи гілок: `if_connected` (accepted within N days), `if_not_connected`, `if_replied`, `if_not_replied`
- Кожен step може мати `branch_true` і `branch_false` (next_step_id для кожного)
- Зворотня сумісність: існуючі кампанії без гілок залишаються лінійними (branch_type = null)
- UI: campaign builder показує деревовидну структуру для гілок

### A/B Testing
- A/B test прив'язаний до конкретного message або connection request step
- 2 варіанти: variant_a_text і variant_b_text
- Random assignment 50/50 при виконанні step
- Tracking: sent_a, sent_b, replies_a, replies_b
- Winner: chi-square test або simple ratio після мінімум 20 відправок на варіант
- UI: inline в campaign builder + окрема Analytics секція

### Smart Inbox
- Playwright scraping: LinkedIn messaging page (`linkedin.com/messaging/`)
- Читаємо conversations/threads і messages
- Зберігаємо в `inbox_messages` таблиці (thread_id, lead_id, direction, text, timestamp)
- Polling кожні 15 хвилин (cron) для нових повідомлень
- Reply через Playwright (не API — LinkedIn не має офіційного Messaging API)
- UI: InboxPage — список тредів зліва, чат справа, textarea для відповіді

### Email Discovery
- Primary: Hunter.io API (email finder by first+last name + domain)
- Fallback: Apollo.io People Search API
- Зберігаємо в leads.email + leads.email_source + leads.email_found_at
- Manual trigger: кнопка "Find Email" в leads таблиці
- Auto-discovery: опційно після visit step (налаштовується в Settings)
- API ключі зберігаємо в app_settings таблиці (hunter_api_key, apollo_api_key)

### Database Migration
- Підхід: migration scripts в `backend/src/migrations/`
- initDb() перевіряє версію і застосовує pending migrations
- Всі нові поля nullable або з defaults (зворотня сумісність)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Codebase
- `backend/src/services/storage.ts` — DB init, schema, helpers (extend don't replace)
- `backend/src/services/browser.ts` — getBrowser(), saveSession(), loadSession()
- `backend/src/services/linkedin.ts` — visitProfile(), sendConnection(), sendMessage()
- `backend/src/workers/campaignWorker.ts` — runWorkerCycle(), executeStep(), startWorker()
- `backend/src/routes/campaigns.ts` — CRUD patterns to follow
- `backend/src/routes/leads.ts` — import pattern, validation
- `backend/src/index.ts` — Express app, WebSocket, routers registration
- `frontend/src/lib/api.ts` — API client patterns
- `frontend/src/pages/CampaignBuilderPage.tsx` — existing campaign builder (extend for branches/AB)
- `frontend/src/pages/LeadsPage.tsx` — leads table (extend for email discovery)
- `frontend/src/App.tsx` — routing (add new pages)

### Planning References
- `.planning/ROADMAP.md` — Phase 4 goals and success criteria
- `.planning/REQUIREMENTS.md` — ADV-01..25 requirements

</canonical_refs>

<specifics>
## Specific Ideas

- Hunter.io API endpoint: `https://api.hunter.io/v2/email-finder?domain=X&first_name=Y&last_name=Z&api_key=K`
- Apollo.io API endpoint: `https://api.apollo.io/v1/people/match`
- LinkedIn messaging URL: `https://www.linkedin.com/messaging/thread/{threadId}/`
- Campaign branch UI: можна використати react-flow або простіший custom tree renderer
- A/B chi-square: мінімальний sample size 20 на варіант перед оголошенням winner

</specifics>

<deferred>
## Deferred Ideas

- Webhooks (Slack/Telegram) — наступна фаза
- Residential proxy — наступна фаза
- Teamwork / multi-user accounts — якщо буде SaaS
- CRM integrations (HubSpot, Salesforce) — майбутнє
- Mobile app — не в планах

</deferred>

---

*Phase: 04-advanced-features*
*Context gathered: 2026-05-13*
