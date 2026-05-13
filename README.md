# LinkedIn Outreach Automation

Self-hosted LinkedIn outreach automation with Playwright — A/B testing, Smart Inbox, multi-account, conditional branches, email discovery, AI icebreaker, and dynamic account health scoring.

## One-click Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/new?referralCode=linkedin-outreach)

## Setup in 3 Steps

1. **Deploy** — click the button above (Railway) or run locally with Docker
2. **Connect LinkedIn** — open the dashboard, the setup wizard guides you through login
3. **Create campaign** — import leads from CSV or Sales Navigator, build steps, hit Play

## Features

| Feature | Status |
|---------|--------|
| Playwright automation (human-like) | ✅ |
| Anti-detection (Bezier mouse, random delays) | ✅ |
| Multi-account with parallel campaigns | ✅ |
| Dynamic daily limits + account health score | ✅ |
| Warmup mode for new accounts | ✅ |
| A/B testing with automatic winner detection | ✅ |
| Conditional campaign branches | ✅ |
| Smart Inbox | ✅ |
| Email discovery (Hunter.io + Apollo.io) | ✅ |
| AI Icebreaker (OpenAI / Anthropic) | ✅ |
| Profile enrichment (13 template variables) | ✅ |
| Sales Navigator import | ✅ |
| Per-account proxy support | ✅ |
| Full REST API | ✅ |
| React dashboard with WebSocket live updates | ✅ |

## Template Variables

Use these in connection notes and messages:

| Variable | Source |
|----------|--------|
| `{firstName}` | CSV / manual |
| `{lastName}` | CSV / manual |
| `{company}` | CSV / manual |
| `{title}` | CSV / manual |
| `{myName}` | Settings |
| `{headline}` | LinkedIn profile (scraped) |
| `{location}` | LinkedIn profile (scraped) |
| `{yearsAtCompany}` | LinkedIn profile (scraped) |
| `{school}` | LinkedIn profile (scraped) |
| `{skills}` | LinkedIn profile (scraped) |
| `{recentPost}` | LinkedIn profile (scraped) |
| `{mutualConnections}` | LinkedIn profile (scraped) |
| `{summary}` | LinkedIn profile (scraped) |
| `{icebreaker}` | AI-generated (OpenAI / Anthropic) |

## Running Locally

```bash
# Clone
git clone https://github.com/ybodnar3-ui/linkedin-outreach-automation.git
cd linkedin-outreach-automation

# Start with Docker
docker compose up

# Or manually:
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Backend port (default 3001) |
| `NODE_ENV` | `production` or `development` |
| `FRONTEND_URL` | Frontend URL for CORS (production) |

API keys (Hunter, Apollo, OpenAI, Anthropic) are set via the Settings page in the dashboard — no env vars needed.

## Account Health Score

Each LinkedIn account has a health score (0-100) that dynamically adjusts daily limits:

- **CAPTCHA detected** → −30
- **LinkedIn warning** → −20  
- **Account restriction** → −50
- **Healthy day** → +5 (nightly at 00:05)

**Effective limit** = `floor(MAX_LIMIT × health/100)`

**Warmup schedule** for new accounts:
- Days 1-7: max 5 connections/day
- Days 8-14: max 10/day
- Days 15-21: max 15/day
- Day 22+: full limit

## REST API

All endpoints under `/api/`:

- `GET/POST/PUT/DELETE /api/campaigns`
- `GET/POST/DELETE /api/leads` + `POST /api/leads/import`
- `GET /api/analytics/overview|daily|campaigns-summary`
- `GET/PUT /api/settings` + `POST /api/settings/login`
- `GET/POST/DELETE /api/accounts` + `GET /api/accounts/:id/health`
- `GET /api/inbox` + `POST /api/inbox/:threadId/reply`
- `GET/POST/DELETE /api/ab-tests`
- `GET /api/health`
