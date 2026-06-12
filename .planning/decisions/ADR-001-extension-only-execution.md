# ADR-001: Extension-only execution — remove server-side Playwright

- **Status:** Accepted
- **Date:** 2026-06-09
- **Deciders:** Project owner (ybodnar3)

## Context

The project automates LinkedIn outreach. The documented design (CLAUDE.md, original ТЗ)
assumed **server-side headless Playwright** running 24/7 in the cloud (Railway), so the
user "could close their Mac."

In reality the project evolved a **second execution engine — a Chrome Extension** that
runs inside the user's real browser. Today both engines coexist behind an
`isExtensionActive()` fork in `campaignWorker.ts`:

- **Extension path** (works): real Chrome, residential IP, live logged-in session.
  This is what actually sends connections/messages today.
- **Server Playwright path** (half-dead): `browser.ts` / `linkedin.ts` / `inboxPoller.ts`.
  Observed failing live with `browserContext.newPage: Target page, context or browser
  has been closed`; leaks contexts (`closeAccountBrowser()` is exported but never called);
  no session-expiry detection; assumes cookie files in `data/sessions/`.

### The core contradiction

LinkedIn's anti-automation is tuned to catch **datacenter IP + headless fingerprint**.
That is exactly what server-side Playwright on Railway looks like. So the engine that
satisfies "24/7 cloud" (headless Playwright) **directly violates the project's #1 goal:
"no account ban."** The engine that satisfies "no ban" (the extension) cannot run without
the user's browser open.

You cannot have all three of {safe, cloud-24/7, self-hosted-cheap} with LinkedIn. Pick two.
Today the project pays the complexity and maintenance cost of **both** engines while
getting the full benefit of **neither** — and the split is why connection-acceptance
detection fell through the cracks (the bug fixed 2026-06-09).

## Decision

**Commit to the Chrome Extension as the single execution engine. Remove server-side
Playwright execution entirely.**

- All LinkedIn actions (visit, connect, message, check_connection, follow, inbox reads)
  go through the extension task queue.
- Server-side `browser.ts`, Playwright action functions in `linkedin.ts`, the
  Playwright-based `inboxPoller`, manual-login flow, and `data/sessions/` cookie storage
  are removed (see ROADMAP Phase 1).
- Inbox/reply reading moves to the extension (new task type).
- SMTP email steps stay server-side (no browser needed — legitimate).
- The backend becomes a **coordination + state + dashboard + task-queue server**, not a
  browser farm. Playwright is dropped from `package.json` and the Docker image.

## Goal reframe (honest)

- ❌ Old: "24/7 cloud, close your Mac."
- ✅ New: "Runs whenever Chrome is open; backend (state + dashboard) lives in the cloud
  24/7; automation executes safely through the user's real browser; survives sleep and
  auto-resumes."
- True lights-out 24/7 without the user's machine is only safe on a **dedicated always-on
  machine** (mini-PC / always-on VM with a real Chrome profile + residential IP) running
  the extension — never headless in a datacenter.

## Consequences

- ✅ Deletes a whole class of bugs (context leaks, `browserContext closed`, dual sessions).
- ✅ Backend container shrinks (no Chromium); deploy gets cheap and simple.
- ✅ Single code path — easier to reason about, fewer places for logic to fall through.
- ⚠️ No automated execution while the user's browser is closed (accepted; safer by design).
- ⚠️ Reversible via git history if a deliberate, proxy-backed "no-extension mode" is ever
  built as a separate project.

## Scope note

Assumes a **personal / single-operator tool** (one operator, self-hosted, SQLite).
If the project pivots to **multi-tenant SaaS**, this ADR still holds (each customer needs
their own browser+extension; headless for customers is equally unsafe), but the data layer
(SQLite → Postgres), per-tenant isolation, and extension distribution become new decisions.
