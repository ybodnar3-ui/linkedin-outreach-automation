# Security posture

This is a **self-hosted, single-operator** tool (see ADR-001). The posture below
is deliberately right-sized for that. If this ever becomes a multi-tenant SaaS,
several items move from "accepted" to "must fix".

## Authentication

- **Dashboard:** username/password (`APP_USERNAME` / `APP_PASSWORD`) → JWT, 30-day
  expiry, signed with `JWT_SECRET`. Login is rate-limited (10 attempts / 15 min / IP)
  with timing-safe comparison. The server refuses to boot in production without
  `JWT_SECRET`.
- **Extension:** a separate random `extension_token` (UUID) in `app_settings`,
  rotatable via `POST /api/extension/token/regenerate`. Used only by the
  `/api/extension/*` routes.

## Accepted risks (documented, OK for self-hosted single-user)

- **JWT stored in `localStorage`** (not httpOnly cookie). Exposed to XSS in theory.
  Accepted because: single trusted operator, no third-party content rendered into
  the dashboard, self-hosted origin. *SaaS → move to httpOnly + CSRF.*
- **WS token in query string** (`ws://host/?token=…`). Can appear in logs.
  Accepted for localhost/self-host. *SaaS → subprotocol or post-connect auth.*
- **API keys (Hunter/Apollo/OpenAI/Anthropic/CRM/SMTP) stored plaintext in SQLite.**
  Accepted: the DB file is on the operator's own machine. Masked (`***`) in
  `GET /api/settings`. *SaaS → per-tenant encryption at rest.*

## Controls in place

- **SSRF:** strict `linkedin.com/in/<slug>` regex on every lead-ingest path;
  webhook URLs blocked for localhost / private / metadata IP ranges.
- **SQL injection:** all queries parameterized; identifier allow-listing in the
  one place dynamic column names are used.
- **CSV:** size (5 MB) + row (5000) caps; formula-injection guard on export.
- **CORS:** allow-list (configured `FRONTEND_URL` + localhost only).
- **PII:** error messages return button labels only, never raw page text.
- **Worker safety:** cross-process lease lock (`worker_lock`) prevents two workers
  acting simultaneously (= double LinkedIn actions = ban risk).

## Data

- SQLite at `data/database.sqlite`. Automatic backups: daily 03:00 + on startup,
  last 7 kept in `data/backups/` (online `db.backup()` API).
- Schema changes are versioned (`schema_migrations`).

## Reporting

Single-operator tool — no formal disclosure process. Fix forward.
