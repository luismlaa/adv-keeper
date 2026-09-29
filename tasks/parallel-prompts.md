# Parallel Prompts — Keeper

Prerequisite: `chore/scaffold` merged into `main`.

Setup (run once from `C:\Users\LUIS\adv-keeper`):

```bash
git checkout main && git pull --ff-only 2>/dev/null; git status
git worktree add ../adv-keeper-wt/concierge-chat    -b feat/concierge-chat
git worktree add ../adv-keeper-wt/owner-dashboard   -b feat/owner-dashboard
git worktree add ../adv-keeper-wt/demo-experience   -b feat/demo-experience
git worktree add ../adv-keeper-wt/live-integrations -b feat/live-integrations
# in each worktree: npm install && copy ..\..\adv-keeper\.env.local .
```

Open a fresh `claude` session inside each worktree dir and paste its prompt. A, B and C make up **M1 (pitch demo)**. D is **M2 (first live client)**; it can start in parallel but merges after A.

**Cross-track contracts (agreed up front, do not change unilaterally):**
- Dashboard entry route is `/agenda` (B). Login page is `/login` (B).
- Client chat route is `/chat/[slug]` (A).
- A exports `handleClientMessage(input: { businessId: string; phone: string; text: string; channel: "web" | "whatsapp" }): Promise<{ reply: string; conversationId: string }>` from `src/lib/chat/handle-message.ts`. D's WhatsApp webhook calls it.
- Payments webhook route is `/api/webhooks/payments/[provider]` (C). It resolves the deposit by `linkId`, loads the business, then calls `resolveAdapters(business, env).payments.verifyWebhook` followed by `BookingService.handlePaymentEvent`. D only adds adapters and never edits the route.
- **Frozen core**: no track edits `src/lib/domain/**`, `src/lib/schemas/**`, `src/lib/store/**`, `src/lib/config/**`, `src/lib/booking/**` or `supabase/migrations/**`. If one of these needs a change, stop and describe it in the PR. It gets its own `chore/core-*` branch.
- Any track may add dependencies to `package.json`. On a lockfile conflict, take `main`'s lockfile and re-run `npm install`.

---

## Task A — Concierge chat · branch `feat/concierge-chat` · worktree `../adv-keeper-wt/concierge-chat`

```text
You are working on Keeper in an isolated git worktree on branch `feat/concierge-chat`. Do NOT touch `main` or other branches.

First read `CLAUDE.md`, then `~/.claude/projects/C--Users-LUIS-adv-keeper/memory/MEMORY.md`, then run `/graphify query "concierge agent tool executor booking service"` before opening files.

Your task: make the client-facing chat work end to end on the demo tenant with real Claude.
1. `src/lib/chat/handle-message.ts` exports `handleClientMessage({ businessId, phone, text, channel })`. It should: load the business and resolve settings; findOrCreateClient; load or create the conversation (`conversations` table, per client+channel); load the last 20 `messages` and rebuild the Anthropic history (store the full assistant/tool content blocks in `messages.payload` so tool_use/tool_result pairs replay correctly); build the system blocks (`buildSystemBlocks`); run `runConciergeTurn` with `anthropicLlm(new Anthropic())`, `createToolExecutor` and a `BookingService` built with `SupabaseStore` + `resolveAdapters`; persist the client message and the new assistant/tool messages; bump `last_message_at`; log to activity_log. Keep conversation persistence in `src/lib/chat/conversation-repo.ts`, which uses the admin client and always filters by business_id.
2. `src/app/api/chat/route.ts`: POST `{ slug, text }`. Identify the web client with an httpOnly cookie that holds a random demo phone (`+1809000xxxx`) created on the first visit. Validate the body with zod. Return `{ reply, messages }`. Enforce `DEMO_MAX_MESSAGES_PER_SESSION` for demo tenants (count client messages in the conversation) and return a friendly 429.
3. `src/app/chat/[slug]/page.tsx` plus client components under `src/app/chat/[slug]/_components/`: a mobile-first, WhatsApp-like chat UI in Spanish with suggested quick replies ("¿Cuánto cuesta…?", "¿Tienes para mañana?", "Mis paquetes"). Render links as tappable buttons, and show "Keeper está escribiendo…" while waiting.
4. Unit tests for history reconstruction and the rate limit (tests/unit/chat-*.test.ts) using MemoryStore or pure functions.

You OWN (edit only inside): `src/lib/chat/**`, `src/lib/agent/**`, `prompts/**`, `src/app/api/chat/**`, `src/app/chat/**`, `tests/unit/chat-*.test.ts`.
Do NOT edit (owned elsewhere): `src/app/(dashboard)/**`, `src/app/demo/**`, `src/app/pay/**`, `src/app/api/webhooks/**`, `src/app/api/cron/**`, `src/lib/adapters/**`, and the frozen core listed in tasks/parallel-prompts.md. If you change prompt behaviour, create `prompts/concierge/v2/` + a CHANGELOG entry and bump `CONCIERGE_PROMPT_VERSION`. Never edit v1.

Acceptance criteria:
- On `npm run dev` with the seeded demo, `/chat/spa-demo` answers prices from the catalog, offers real slots, creates a hold and returns a `/pay/demo/...` link.
- Asking for a discount creates a pending `approval_requests` row and the reply says the owner will confirm.
- Reloading the page keeps the conversation (cookie + persisted messages).
- `npm run check` passes (existing 46 tests + your new ones).

When done: commit, push and open a PR against `main` with `gh pr create` (if there is no remote, stop at a clean branch and write a `git diff main...HEAD --stat` summary). Do not merge; a human merges after review.
```

---

## Task B — Owner dashboard · branch `feat/owner-dashboard` · worktree `../adv-keeper-wt/owner-dashboard`

```text
You are working on Keeper in an isolated git worktree on branch `feat/owner-dashboard`. Do NOT touch `main` or other branches.

First read `CLAUDE.md`, then `~/.claude/projects/C--Users-LUIS-adv-keeper/memory/MEMORY.md`, then run `/graphify query "appointments client packages reactivation approval requests RLS"` before opening files. Read `node_modules/next/dist/docs/` for auth/proxy/server actions before writing them (Next 16: middleware is now `proxy`).

Your task: build the owner's dashboard in Spanish, mobile-friendly, using the RLS session client (`createSessionClient`) so every query is tenant-scoped by Postgres.
1. Set up shadcn/ui (`npx shadcn@latest init`) and the components you need.
2. `/login`: email and password with Supabase Auth, plus `src/proxy.ts` to refresh the session and redirect unauthenticated users away from dashboard routes.
3. `(dashboard)` layout with nav: Agenda · Clientas · Reactivar · Aprobaciones · Servicios · Ajustes. Show the business name (via memberships).
4. `/agenda`: day and week views in America/Santo_Domingo time. Each appointment shows client, service and time, plus deposit status: 💰 Pagado / ⏳ Pendiente (with expiry) / 📦 Paquete. Owner actions (server actions): mark completed (consumes a package session with `consumeSession` when `client_package_id` is set), mark no-show, and cancel. Use `transition()` from the domain layer. Log each action to activity_log with a reason.
5. `/clientas` list with search, and `/clientas/[id]`: contact info, notes, active packages (used/remaining, `nextSessionLabel`, what comes next based on `interval_days`), appointment history, and last visit.
6. `/reactivar`: `findReactivationCandidates` (weeks from settings). Each row gets a "Reenganchar" button (server action) that records a `notifications_sent` row (kind `reactivation`, `dedupeKey.reactivation`), sets `last_reengaged_at`, and shows a preview of the message. Actual WhatsApp sending is D's job, so just call `resolveAdapters(...).messaging.sendTemplate` (it's the web channel in demo).
7. `/aprobaciones`: pending approval requests. Approve and reject just set the status and log it (no money movement).
8. `/servicios`: CRUD for services and package templates (prices entered in RD$ and stored in centavos). `/ajustes`: edit business settings validated by `businessSettingsSchema`, plus a "Conectar Google Calendar" button linking to `/api/integrations/google/start` (route built by D).
Put data-access queries in `src/lib/dashboard/**` (pure mapping functions unit-tested in `tests/unit/dashboard-*.test.ts`).

You OWN (edit only inside): `src/app/(dashboard)/**`, `src/app/login/**`, `src/proxy.ts`, `src/components/**`, `src/lib/dashboard/**`, `src/app/globals.css`, `components.json`, `tests/unit/dashboard-*.test.ts`.
Do NOT edit: `src/app/page.tsx`, `src/app/demo/**`, `src/app/chat/**`, `src/app/pay/**`, `src/app/api/**`, `src/lib/agent/**`, `src/lib/adapters/**`, or the frozen core.

Acceptance criteria:
- Logging in as the demo owner lands on `/agenda` showing this week's seeded appointments with correct 💰/⏳/📦 badges in local time.
- `/reactivar` lists exactly the 8 seeded candidates. Reengaging one removes her from the list.
- A second test owner of another business sees none of the demo data (RLS).
- `npm run check` passes.

When done: commit, push and open a PR against `main` with `gh pr create` (or stop at a clean branch with a `git diff main...HEAD --stat` summary if there is no remote). Do not merge.
```

---

## Task C — Demo experience · branch `feat/demo-experience` · worktree `../adv-keeper-wt/demo-experience`

```text
You are working on Keeper in an isolated git worktree on branch `feat/demo-experience`. Do NOT touch `main` or other branches.

First read `CLAUDE.md`, then `~/.claude/projects/C--Users-LUIS-adv-keeper/memory/MEMORY.md`, then run `/graphify query "demo dataset seed fake payment provider webhook"` before opening files. Read `docs/demo-pitch.md`: your work must make that script run flawlessly.

Your task: make the product demo-able by prospects on their own and in pitch meetings.
1. Landing `src/app/page.tsx` (Spanish): a hero based on "Keeper responde, agenda con anticipo, lleva los paquetes y trae de vuelta a la clienta", a 4-benefit section, a "Cómo funciona" section, and CTA → `/demo`.
2. `/demo`: two cards. "Soy la clienta" links to `/chat/spa-demo`. "Soy la dueña" uses a server action that signs in with `DEMO_OWNER_EMAIL`/`DEMO_OWNER_PASSWORD` through `createSessionClient().auth.signInWithPassword` and redirects to `/agenda`. Add a note that data resets every night.
3. `/pay/demo/[linkId]`: a simulated hosted checkout showing the business name, service, amount and "Pago simulado — no se cobra nada", with a "Pagar anticipo" button. Its server action posts an HMAC-signed body (`signDemoPayload`, header `DEMO_SIGNATURE_HEADER`) to `/api/webhooks/payments/fake`, then shows a success screen with a link back to the chat.
4. `/api/webhooks/payments/[provider]/route.ts`: read the raw body, find the deposit by linkId (parse leniently per provider), load the business, check that `business.paymentProvider` matches the route provider, run `resolveAdapters(business, env).payments.verifyWebhook`, then `BookingService.handlePaymentEvent`. Answer 200 for already-processed or ignored events, 401 for a bad signature. Log everything.
5. `/api/cron/demo-reset`: authorized with `isAuthorizedCron`, it calls `seedDemo` (src/lib/demo/seed.ts).
6. Claude cost guard: `src/lib/rate-limit/**` with a daily demo message budget (`DEMO_DAILY_MESSAGE_BUDGET`, counted from `messages` rows of the demo business today, role client) exposed as `isDemoBudgetExhausted(businessId)`. Task A will call it, so document the export in the PR.
7. Tests: webhook route logic extracted into a testable function (`src/lib/demo/payment-webhook.ts` or similar) with tests for a valid, duplicate, forged, or amount-mismatched payment (tests/unit/demo-*.test.ts).

You OWN (edit only inside): `src/app/page.tsx`, `src/app/(marketing)/**`, `src/app/demo/**`, `src/app/pay/**`, `src/app/api/webhooks/payments/**`, `src/app/api/cron/demo-reset/**`, `src/lib/demo/**`, `src/lib/rate-limit/**`, `supabase/seed/**`, `public/**`, `tests/unit/demo-*.test.ts`.
Do NOT edit: `src/app/(dashboard)/**`, `src/app/chat/**`, `src/app/api/chat/**`, `src/lib/agent/**`, `src/lib/adapters/**`, or the frozen core.

Acceptance criteria:
- From `/demo`, a prospect can enter as the owner with one click and see the dashboard (once B is merged), or open the chat.
- Paying on `/pay/demo/...` flips the appointment to `confirmed` and the deposit to `paid`. Paying twice is harmless.
- A forged signature gets 401 and changes nothing.
- `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/demo-reset` re-seeds the tenant.
- `npm run check` passes.

When done: commit, push and open a PR against `main` with `gh pr create` (or stop at a clean branch with a `git diff main...HEAD --stat` summary if there is no remote). Do not merge.
```

---

## Task D — Live integrations · branch `feat/live-integrations` · worktree `../adv-keeper-wt/live-integrations`

```text
You are working on Keeper in an isolated git worktree on branch `feat/live-integrations`. Do NOT touch `main` or other branches.

First read `CLAUDE.md`, then `~/.claude/projects/C--Users-LUIS-adv-keeper/memory/MEMORY.md`, then run `/graphify query "adapter registry calendar provider payment provider messaging channel"` before opening files. Read `docs/onboarding-negocio.md`.

Your task: implement the live adapters and background jobs so a real business can go live. Every external call needs a timeout (AbortSignal.timeout), retry with backoff on 5xx/429, and business-context logging.
1. WhatsApp Cloud API. Create `src/lib/adapters/whatsapp/**` with a `MessagingChannel` implementation (text + template sends via Graph API `WHATSAPP_GRAPH_VERSION`) and `src/app/api/webhooks/whatsapp/route.ts`: a GET verify handshake, and a POST that verifies `X-Hub-Signature-256` with `WHATSAPP_APP_SECRET`, maps `phone_number_id` → business, dedupes by message id, and calls `handleClientMessage` from `src/lib/chat/handle-message.ts` (Task A contract) before replying with a text message. Return 200 fast.
2. Google Calendar. Create `src/lib/adapters/google/**` with a `CalendarProvider` (freeBusy query, events insert/delete) using a refresh token stored encrypted in `integrations` (AES-256-GCM via `src/lib/crypto.ts` with `ENCRYPTION_KEY`), plus OAuth routes `src/app/api/integrations/google/{start,callback}/route.ts` (scope `calendar.events` + `calendar.freebusy`, offline access, the `state` param bound to the owner session and business).
3. Azul and Cardnet. Create `src/lib/adapters/azul/**` and `src/lib/adapters/cardnet/**` implementing `PaymentProvider` for their hosted payment pages. Our link should be `APP_URL/api/pay/<provider>/<linkId>`, which builds the signed redirect/session to the gateway, so the link stays ours and trackable. `verifyWebhook` must validate the gateway's hash or query the gateway for status; never trust unsigned callbacks. Where the exact spec is unknown without merchant docs, implement it against the public docs, isolate the hash builder in one function with tests, and flag it clearly in the PR.
4. `src/lib/adapters/live.ts`: `registerLiveAdapters` factory choosing by `business.paymentProvider`, with Google calendar + WhatsApp messaging. Import it for side effects from `src/lib/adapters/registry.ts`, which you now own.
5. Crons (all `isAuthorizedCron`, all idempotent through `store.recordNotification` + `dedupeKey`, and all iterating every live business): `holds-expiry` (`BookingService.expireHolds`), `reminders` (`dueDayBeforeReminders`, template `day_before_reminder`), `package-nudges` (`isPackageNudgeDue`, template `package_nudge` using "te toca la sesión N de M, ¿agendamos?"), and `reactivation-scan` (a weekly digest for the owner in activity_log only, with no auto-messages to clients). Put template texts/variables in `src/lib/notifications/templates.ts`.
6. Tests: signature verification (WhatsApp, gateway hash), crypto round-trip, template rendering, and cron selection logic (tests/unit/live-*.test.ts). Mock fetch and never call real APIs in tests.

You OWN (edit only inside): `src/lib/adapters/**` (except `calendar/fake.ts`, `payments/fake.ts`, `messaging/web.ts`, `messaging/recording.ts`), `src/lib/crypto.ts`, `src/lib/notifications/**`, `src/app/api/webhooks/whatsapp/**`, `src/app/api/integrations/**`, `src/app/api/pay/**`, `src/app/api/cron/{holds-expiry,reminders,package-nudges,reactivation-scan}/**`, `vercel.json`, `tests/unit/live-*.test.ts`.
Do NOT edit: `src/lib/chat/**` (import only), `src/app/api/webhooks/payments/**` (Task C), dashboard/demo/chat UI, or the frozen core.

Acceptance criteria:
- With test credentials, a WhatsApp message to the business number gets a Keeper reply. The same webhook delivered twice replies once.
- Connecting Google Calendar stores an encrypted token. Busy blocks in that calendar disappear from `check_availability`, and confirmed bookings create events.
- The gateway adapter produces a redirect to the sandbox and verifies its callback (hash tests pass).
- Running each cron twice sends nothing new the second time.
- `npm run check` passes.

When done: rebase on `main` after Task A merges, commit, push and open a PR against `main` with `gh pr create` (or stop at a clean branch with a `git diff main...HEAD --stat` summary if there is no remote). Do not merge.
```
