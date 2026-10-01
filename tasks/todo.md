# Keeper — roadmap & tracker

## Fase 0 — Scaffold (branch `chore/scaffold`) ✅
- [x] Next.js 16 + TS strict + Tailwind, deps, env loader (zod), `.env.example`
- [x] Migration: full schema + RLS + exclusion constraint + triggers
- [x] Domain: slots, deposit, state machine, packages, reactivation, reminders
- [x] Adapters: interfaces + fakes (calendar, payments w/ HMAC, web/recording channels) + registry
- [x] Store port: MemoryStore + SupabaseStore
- [x] BookingService: hold → deposit link → payment → confirm; expiry; idempotent
- [x] Agent: zod tools, executor with tiers/caps, prompt v1 (CAN/CANNOT), tool-use loop
- [x] Demo dataset + `npm run seed:demo`
- [x] Tests: 46 unit + smoke (scripted LLM end-to-end)
- [x] Docs: deploy, onboarding, pitch; CLAUDE.md; project memory; graphify

## Arranque ✅ (2026-09-30)
- [x] PR #1 mergeado · Supabase creado · migración aplicada · Auth sin registro público
- [x] `.env.local` · `npm run seed:demo` (8 servicios, 20 clientas, 16 citas, 10 anticipos) · `npm run check` verde (46 tests)

## Hito M1 — Demo lista para pitch ✅ código (falta deploy)
- [x] **A · `feat/concierge-chat`** (PR #4): `/api/chat` + `/chat/[slug]` (persistir conversación/mensajes, cookie de sesión anónima con teléfono demo)
- [x] **B · `feat/owner-dashboard`** (PR #5): login, agenda día/semana 💰/pendiente, ficha clienta, reactivar, aprobaciones, servicios
- [x] **C · `feat/demo-experience`** (PR #3): landing, `/demo`, checkout simulado `/pay/demo/[linkId]` + webhook de pagos, `demo-reset` cron, límites de costo
- [x] Cierre: `isDemoBudgetExhausted` cableado en `handleClientMessage` (429 `daily_budget`), `typecheck` = `next typegen && tsc`, reset real probado
- [ ] Deploy a Vercel con tenant demo; recorrer `docs/demo-pitch.md` completo

## Hito M2 — Primer negocio en vivo
- [ ] **D · `feat/live-integrations`**: WhatsApp (webhook entrante + envío + plantillas), Google Calendar OAuth + adapter, Azul/Cardnet adapters, crons reminders / package-nudges / reactivation-scan / holds-expiry
- [ ] Onboarding real (`docs/onboarding-negocio.md`)
- [ ] P0 checklist de `docs/deploy.md`

## v2 (después del primer cliente)
- [ ] Multi-recurso (varias cabinas/profesionales) — reemplazar exclusion constraint por recurso
- [ ] Venta de paquetes con link de pago desde el chat
- [ ] Métricas: tasa de no-show, conversión chat→reserva, ingresos por anticipos
- [ ] Billing de Keeper a los negocios

## Review
- Fase 0: typecheck + lint + 46 tests en verde. Supabase CLI/Docker no están instalados en esta máquina → la migración no se ejecutó localmente; aplicarla en el proyecto Supabase es el primer paso manual.
- Arranque (2026-09-30): migración aplicada en Supabase y validada con el seed demo; `npm run check` verde.
- M1 (2026-09-30): A/B/C en paralelo en worktrees → PRs #3/#4/#5; integración combinada verificada antes del merge (119 tests + build). Cierre: 120 tests en verde, `/api/cron/demo-reset` re-sembró la demo real (16 citas, 10 anticipos, 0 restos de prueba), chat respondiendo con el tope diario activo.
