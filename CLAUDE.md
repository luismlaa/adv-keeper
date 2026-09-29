@AGENTS.md

# Keeper

> Asistente de reservas para spas y salones (RD): responde precios al instante, agenda 24/7 cobrando anticipo por link, recuerda citas, lleva paquetes multi-sesión y reactiva clientas inactivas.
> Category: single-agent-app (web-app) · Stack: Next.js 16 + TypeScript strict + Supabase + Claude (Anthropic TS SDK) · Owner: Luis (producto propio, SaaS multi-tenant)

---

## ⚡ Operating System — Workflow Orchestration

1. **Plan Mode Default** — Enter plan mode for ANY non-trivial task (3+ steps or an architectural decision). Write the spec upfront. If something goes sideways, STOP and re-plan instead of pushing through.
2. **Subagent Strategy** — Use subagents to keep the main context clean: research, exploration, parallel analysis. One task per subagent.
3. **Self-Improvement Loop** — After ANY correction from the owner, capture the lesson in project memory (see Knowledge & Memory) and write a rule that prevents the same mistake.
4. **Verification Before Done** — Never mark a task complete without proving it works: `npm run check`, logs, a demo walkthrough. Ask: *"Would a staff engineer approve this?"*
5. **Demand Elegance (Balanced)** — For non-trivial changes ask *"Is there a more elegant way?"* Skip for obvious fixes — don't over-engineer.
6. **Autonomous Bug Fixing** — Given a bug report, just fix it: logs, failing tests, CI. No hand-holding required.

**🟠 Golden Rule:** Be proactive. Think like an owner. Act like a senior engineer. Never make me repeat myself.

---

## ✅ Task Management

1. **Plan First** — Write the plan to `tasks/todo.md` as checkable items before coding.
2. **Verify Plan** — Check in with the owner before starting implementation.
3. **Track Progress** — Mark items complete in `tasks/todo.md` as you go.
4. **Explain Changes** — High-level summary at each step.
5. **Document Results** — Add a review section to `tasks/todo.md` when done.
6. **Capture Lessons** — On any correction, record a `type: feedback` note in project memory.
7. **Big builds → missions** — For multi-feature work spanning hours/days the owner can run `/mission-control` (user-invoked only — never start one yourself).

---

## 🧠 Knowledge & Memory — read FIRST, it saves context

- **Project memory (the *why*)** → `~/.claude/projects/C--Users-LUIS-adv-keeper/memory/MEMORY.md` (auto-loaded). Decisions, domain glossary (anticipo/hold, paquetes), MVP context, gotchas, lessons. When you learn something non-obvious, add a one-fact flat file (`decision-*.md`, `domain-*.md`, `context-*.md`, `type: reference|feedback`), link with `[[wikilinks]]`, and add a pointer line in `MEMORY.md`.
- **Code graph (the *what connects to what*)** → Graphify. For "where is X used / how does this flow" run `/graphify query "…"` FIRST instead of reading files. Refresh with `/graphify . --update` after structural changes. `graphify-out/` is gitignored — regenerate on a fresh clone with `/graphify . --obsidian`.

Rule of thumb: **code/architecture question → graphify first. "Why / plan / what does this term mean" → project memory first.**

---

## 🔌 Skill Discovery (don't over-do it)

Before hand-rolling a clearly common capability (UI kit setup, deploy, e2e testing, changelog), check `npx skills find <query>` / the **find-skills** skill. Only when a capability is clearly missing.

---

## 🌿 Git & Parallelization

- **`main` is trunk and stays releasable.** Never commit to `main` directly.
- One unit of work → one branch (`feat/`, `fix/`, `chore/`, `refactor/<slug>`) → one focused PR. PR body = what/why + test plan + acceptance criteria. **A human merges** after `npm run check` is green.
- **Multiple instances** — one **git worktree** per track: `git worktree add ../adv-keeper-wt/<slug> -b feat/<slug>`, then a fresh `claude` there. Startup prompts live in `tasks/parallel-prompts.md`. Each instance owns a **disjoint set of files**.
- **Frozen shared core** (owned by nobody during parallel tracks): `src/lib/domain/**`, `src/lib/schemas/**`, `src/lib/store/**`, `src/lib/config/**`, `supabase/migrations/**`. Changing them = a separate `chore/core-<slug>` branch merged first; other tracks rebase.
- `*-wt/` and `.worktrees/` are gitignored.

---

## Build & Run
- `npm install`
- `cp .env.example .env.local` and fill in real values
- Apply `supabase/migrations/*.sql` to your Supabase project (SQL editor or `npx supabase db push`), then `npm run seed:demo`
- `npm run dev` → http://localhost:3000

## Test
- `npm test` (vitest: unit + smoke) · `npm run typecheck` · `npm run lint` · all at once: `npm run check`
- The smoke test (`tests/smoke/booking-flow.test.ts`) runs chat → hold → deposit link → signed payment → confirmed → reminder with a scripted LLM. Keep it green.

## Architecture
- **Domain** `src/lib/domain/` — pure functions: slots, deposit math, appointment state machine, packages, reactivation, reminders. No I/O. Unit-tested.
- **Ports & adapters** `src/lib/adapters/` — `CalendarProvider` (Google | fake), `PaymentProvider` (Azul | Cardnet | fake), `MessagingChannel` (WhatsApp | web). Chosen per business by `integration_mode` (`demo` → fakes) in `registry.ts`; live adapters register via `registerLiveAdapters`.
- **Store** `src/lib/store/` — `KeeperStore` port; `MemoryStore` (tests) and `SupabaseStore` (service role, always filters by `business_id`).
- **Booking** `src/lib/booking/booking-service.ts` — hold → deposit link → payment webhook → confirm (+ calendar event); hold expiry. Idempotent.
- **Agent** `src/lib/agent/` — `concierge.ts` tool-use loop; `tools.ts` zod contracts (strict objects); `tool-executor.ts` validation + tiers + per-turn caps; `prompt.ts` loads `prompts/concierge/<version>/system.md` (cached block + per-turn block).
- **Tenancy** — every table has `business_id`; RLS via `is_member()` on `memberships`. Owners use the RLS session client (`src/lib/db/server.ts`); webhooks/crons/agent use the admin client.
- Config: env via zod (`src/lib/config/env.ts`); per-business settings = `config/business-defaults.json` + `businesses.settings` overrides (`resolveBusinessSettings`).
- Crons in `vercel.json`, authenticated with `isAuthorizedCron` (`src/lib/cron.ts`).

## Critical Rules
- NEVER commit secrets — `.env.local` only; `.env.example` lists every var.
- **Money comes from the catalog, never from the model or the client.** Tools accept `service_id`, never a price. Amounts are integer minor units (centavos).
- **Keeper never touches card data.** Only hosted payment links + verified webhooks.
- Discounts, off-menu prices, cancellations, refunds → `approval_requests` for the owner. No tool may perform them.
- Every side effect is idempotent (unique keys: deposit `link_id`/`provider_txn_id`, appointment `(business, client, starts_at)`, `notifications_sent.dedupe_key`).
- Log business context to `activity_log` (actor, entity, action, **reason**).
- Prompts are versioned: never edit `prompts/concierge/v1` after release — create `v2/` + CHANGELOG entry.
- Business-initiated WhatsApp messages (reminders, nudges, reactivation, deposit links outside 24h) MUST use approved templates.
- Immutable data; many small files (200–400 lines, 800 max); validate all external input at the boundary.

## Gotchas
- Next.js 16: read `node_modules/next/dist/docs/` before using an API; `middleware` is now `proxy`; route `params` are Promises.
- Vercel Hobby only allows daily crons — `holds-expiry` (every 10 min) and `reminders` (hourly) need Vercel Pro, or move them to Supabase `pg_cron`.
- MVP assumes ONE resource per business (DB exclusion constraint `appointments_no_overlap`). Multi-cabin/staff is v2.
- Timezone is `America/Santo_Domingo` (UTC-4, no DST); always compute wall-clock times with `src/lib/domain/time.ts`.
