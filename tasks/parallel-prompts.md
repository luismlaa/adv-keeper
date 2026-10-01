# Parallel Prompts — Keeper

Prerequisite: `chore/scaffold` merged into `main`.

Setup (run once from `C:\Users\LUIS\adv-keeper`):

```bash
git checkout main && git pull --ff-only 2>/dev/null; git status
git worktree add ../adv-keeper-wt/concierge-chat    -b feat/concierge-chat
git worktree add ../adv-keeper-wt/owner-dashboard   -b feat/owner-dashboard
git worktree add ../adv-keeper-wt/demo-experience   -b feat/demo-experience
# in each worktree: npm install && copy ..\..\adv-keeper\.env.local .
```

Open a fresh `claude` session inside each worktree dir and paste its prompt. A, B and C make up **M1 (pitch demo)**. M2 (first live client) is split into D1–D4 — see the M2 section at the end.

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

## Task D — superseded by the M2 split below

## M2: Track D split (D1, D2 and D3 in parallel, then D4)

Prerequisite: the `chore/core-live-prereqs` branch, which holds the shared core for M2:
- `src/lib/crypto.ts`: AES-256-GCM encryption, with the business and provider bound as AAD.
- `src/lib/integrations/repo.ts`: `IntegrationCredentials`, which stores typed, encrypted credentials per business and provider (`google_calendar | azul | cardnet`). `MemoryIntegrationRepo` is the in-memory version for tests.
- Migration `20260930000000_integrations_credentials.sql`.

```bash
git worktree add ../adv-keeper-wt/live-whatsapp        -b feat/live-whatsapp        chore/core-live-prereqs
git worktree add ../adv-keeper-wt/live-google-calendar -b feat/live-google-calendar chore/core-live-prereqs
git worktree add ../adv-keeper-wt/live-payments        -b feat/live-payments        chore/core-live-prereqs
# later, after D1–D3 merge:
git worktree add ../adv-keeper-wt/live-crons           -b feat/live-crons           main
```

**Rules for every D track**
- **Zero cost.** There are no real credentials yet. Build against each provider's public docs. In tests, mock `fetch` by injecting it as a parameter, and never call a real API.
- **External calls.** Every external call needs a timeout (`AbortSignal.timeout`). Retry with backoff only on 5xx and 429. Log the business context to `activity_log` (actor, entity, action, reason). Never log tokens or secrets.
- **Secrets.** Per-business secrets live only in `integrations`, encrypted through `IntegrationCredentials`. Global env holds Keeper-level config only: the Meta app secret and system token, the Google OAuth client, and gateway base URLs.
- **Wiring.** Each track exports a factory. No track edits `src/lib/adapters/registry.ts` or creates `live.ts`; D4 wires everything together.
- **Frozen core.** The frozen core, including the new `src/lib/crypto.ts` and `src/lib/integrations/**`, is import-only. If you need a core change, stop and describe it in the PR.
- **Done means:** tests in `tests/unit/live-<track>-*.test.ts`, `npm run check` passing, and a PR against `main`. Do not merge.

### D1: WhatsApp (`feat/live-whatsapp`)
1. **Channel** (`src/lib/adapters/whatsapp/channel.ts`): export `createWhatsAppChannel({ token, graphVersion, phoneNumberId, fetch? })`, which returns a `MessagingChannel` with kind `whatsapp`.
   - It implements `sendText` and `sendTemplate` through the Graph API endpoint `/{phone-number-id}/messages`.
   - Templates use positional body variables and language `es`.
   - Return the `wamid` as `messageId`.
2. **Templates** (`src/lib/notifications/templates.ts`): the single source of truth for the four templates: `day_before_reminder`, `deposit_link`, `package_nudge` and `reactivation`.
   - `package_nudge` reads "te toca la sesión N de M, ¿agendamos?".
   - For each template: the Spanish body text with `{{1}}`-style placeholders, a `variables(...)` builder and `renderPreview(...)`.
   - Also write `docs/whatsapp-templates.md` with the exact text to submit to Meta for approval.
3. **Webhook** (`src/app/api/webhooks/whatsapp/route.ts`):
   - **GET:** the verify handshake, using `WHATSAPP_VERIFY_TOKEN`.
   - **POST:** verify `X-Hub-Signature-256`, an HMAC-SHA256 of the raw body keyed with `WHATSAPP_APP_SECRET`, compared timing-safe. Return 401 if it fails.
   - **Business lookup:** map `metadata.phone_number_id` to a business through `businesses.whatsapp_phone_number_id`, using a small repo of your own on the admin client.
   - **Dedupe:** dedupe by `wamid` before processing. For example, look for an `activity_log` row with `action = 'whatsapp_inbound'` and `entity_id = wamid`. Flag it in the PR if you think a unique index is needed.
   - **Messages:** send only text messages to `handleClientMessage({ businessId, phone, text, channel: "whatsapp" })`, which is import-only. Reply with `sendText`.
   - **Speed:** answer 200 fast and do the work inside Next 16 `after()`. Read `node_modules/next/dist/docs/` first.
   - **Errors:** map each `ChatError` code to a short Spanish reply. Never leak error details to the client.

**You own:** `src/lib/adapters/whatsapp/**`, `src/lib/notifications/**`, `src/app/api/webhooks/whatsapp/**`, `docs/whatsapp-templates.md`, `tests/unit/live-whatsapp-*.test.ts`.

**Acceptance (all tested with mocked fetch):**
- Signature verification for valid, forged and missing signatures.
- The verify handshake.
- Dedupe: the same webhook delivered twice gets one reply.
- Template rendering.
- The shape of the channel's requests.

### D2: Google Calendar (`feat/live-google-calendar`)
1. **Adapter** (`src/lib/adapters/google/calendar.ts`): export `createGoogleCalendar({ clientId, clientSecret, credentials: IntegrationCredentials, businessId, fetch? })`, which returns a `CalendarProvider` with kind `google`.
   - Get the access token from the stored refresh token and cache it in memory until it expires.
   - `getBusy` uses the freeBusy query. `createEvent` and `deleteEvent` use the events API.
   - `calendarRef` is the business's `googleCalendarId`, defaulting to `primary`.
   - On `invalid_grant`, log "Google desconectado, reconectar en Ajustes" to `activity_log` and throw a typed error.
2. **OAuth routes** (`src/app/api/integrations/google/start/route.ts` and `.../callback/route.ts`):
   - **Start:** requires an owner session (`createSessionClient` plus membership). It redirects to Google with scopes `calendar.events` and `calendar.freebusy`, `access_type=offline` and `prompt=consent`.
   - **State:** HMAC-signed, short-lived, and bound to the user and business, with a nonce cookie.
   - **Callback:** verify the state and exchange the code. Store `{ refreshToken, calendarId: "primary" }` with `IntegrationCredentials.save(businessId, "google_calendar", …, accountEmail)` and log it.
   - **Finish:** redirect to `/ajustes?google=conectado`, or `?google=error` on failure.
   - **Redirect URI:** `APP_URL/api/integrations/google/callback`.

**You own:** `src/lib/adapters/google/**`, `src/app/api/integrations/google/**`, `tests/unit/live-google-*.test.ts`.

**Acceptance (all tested with mocked fetch):**
- State signing and verification, including tampered, expired and other-business states.
- Token refresh and caching.
- Mapping freeBusy results to `Interval`.
- The request shape for creating and deleting events.
- `invalid_grant` handling.

### D3: Payments, Azul and Cardnet (`feat/live-payments`)
Each business is its own merchant. Its credentials come from `IntegrationCredentials` (`azul` / `cardnet`), never from the global `AZUL_MERCHANT_*` env vars. Those env vars may only hold gateway base URLs or sandbox defaults; note this in the PR.

1. **Adapters** (`src/lib/adapters/azul/**` and `src/lib/adapters/cardnet/**`): export `createAzulPayments(...)` and `createCardnetPayments(...)`, each returning a `PaymentProvider`.
   - `createDepositLink` returns a link on our own domain: `APP_URL/api/pay/<provider>/<linkId>`.
2. **Hand-off route** (`src/app/api/pay/[provider]/[linkId]/route.ts`):
   - Load the deposit by linkId with `store.getDepositByLinkId`, then load its business.
   - If the hold has expired or is already paid, show a friendly page instead of continuing.
   - Otherwise build the gateway hand-off. For the Azul Payment Page that is an auto-submitting signed form. For Cardnet, create a session and then redirect.
   - Return and callback handling (a browser return or a server notification, depending on the gateway) also lives under `src/app/api/pay/**`.
   - It must end in `processPaymentWebhook` from `src/lib/demo/payment-webhook.ts` (import-only), or in `verifyWebhook` followed by `BookingService.handlePaymentEvent`.
3. **Verification:** `verifyWebhook` validates the gateway's hash (Azul AuthHash) or asks the gateway for the transaction status (Cardnet). Never trust an unsigned callback, and check the amount and the linkId.
4. **Hash builders:** put each hash or signature builder in one pure function, tested against the examples in the public docs. State clearly in the PR that these must be validated with the first client's sandbox credentials.

**You own:** `src/lib/adapters/azul/**`, `src/lib/adapters/cardnet/**`, `src/app/api/pay/**`, `tests/unit/live-payments-*.test.ts`.

**Acceptance (all tested with mocked fetch):**
- The hash builders match the doc examples.
- Forged, tampered and amount-mismatched callbacks are rejected.
- A duplicate callback is harmless.
- An expired link is refused.

### D4: Crons and live wiring (`feat/live-crons`, after D1–D3 merge)
1. **Live factory** (`src/lib/adapters/live.ts`): the `registerLiveAdapters` factory.
   - Messaging is WhatsApp, using the business's `whatsappPhoneNumberId`.
   - Calendar is Google.
   - Payments are chosen by `business.paymentProvider`.
   - Import `live.ts` for its side effects from `registry.ts`, which D4 owns.
2. **Crons:** all use `isAuthorizedCron`, all stay idempotent through `store.recordNotification` plus a `dedupeKey`, and all loop over every live business.
   - `holds-expiry`: calls `BookingService.expireHolds`.
   - `reminders`: uses `dueDayBeforeReminders` and the `day_before_reminder` template.
   - `package-nudges`: uses `isPackageNudgeDue` and the `package_nudge` template.
   - `reactivation-scan`: a weekly digest for the owner, written to `activity_log` only, with no messages to clients.
3. **Zero-cost scheduling:**
   - `package-nudges` (daily) and `reactivation-scan` (weekly) go in `vercel.json`.
   - `holds-expiry` (every 10 minutes) and `reminders` (hourly) go in a new migration using `pg_cron` and `pg_net`. It calls `net.http_get` on `APP_URL/api/cron/<name>` with the `CRON_SECRET` bearer token, read from Supabase Vault.
   - Document the Vault setup step in `docs/deploy.md`.

**You own:** `src/lib/adapters/live.ts`, `src/lib/adapters/registry.ts`, `src/app/api/cron/{holds-expiry,reminders,package-nudges,reactivation-scan}/**`, `vercel.json`, the new pg_cron migration, `docs/deploy.md`, `tests/unit/live-crons-*.test.ts`.

**Acceptance:**
- Running each cron twice sends nothing new the second time.
- A live business resolves the live adapters.
- A demo business still resolves the fakes.
