# Pendientes — Keeper

_Última actualización: 2026-09-30. Fase 0 mergeada (PR #1). Arranque ✅. Hito M1 ✅ — demo en producción en https://adv-keeper.vercel.app (Vercel Hobby, auto-deploy desde `main`). **En curso: Hito M2.**_

Leyenda: 👤 = lo haces tú (cuentas, credenciales, trámites) · 🤖 = lo construye una sesión de Claude (prompt listo en `tasks/parallel-prompts.md`)

---

## 1. Arranque — 👤 ✅
- [x] Revisar y hacer merge del PR `chore/scaffold` → `main`
- [x] Crear proyecto en **Supabase** (región us-east-1)
- [x] Aplicar `supabase/migrations/20260928000000_init.sql` (SQL editor o `npx supabase db push`)
- [x] En Supabase Auth: desactivar registro público
- [x] Crear `.env.local` desde `.env.example` y llenar:
  - [x] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  - [x] `ANTHROPIC_API_KEY`
  - [x] `ENCRYPTION_KEY` → `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  - [x] `CRON_SECRET`, `DEMO_OWNER_PASSWORD`, `DEMO_PAYMENT_WEBHOOK_SECRET` (strings aleatorios ≥16)
- [x] `npm install && npm run seed:demo` → debe crear "Spa Demo · Keeper" y la usuaria demo
- [x] `npm run check` en verde

## 2. Hito M1 — Demo lista para pitch ✅ (2026-09-30)
- [x] **A · Chat de la clienta** (PR #4): `/chat/spa-demo` con Claude real; guarda la conversación y respeta el límite de mensajes
- [x] **B · Dashboard de la dueña** (PR #5): login, agenda día/semana 💰/⏳/📦, ficha de clienta con paquetes, reactivar, aprobaciones, servicios, ajustes
- [x] **C · Experiencia demo** (PR #3): landing, `/demo` con entrada en un clic, checkout simulado, webhook de pagos, reset nocturno, tope de gasto de Claude
- [x] Revisar y hacer merge de A, B y C (👤)
- [x] Cierre M1: tope diario de la demo conectado al chat, `typecheck` genera tipos de rutas, reset real de la demo probado con `CRON_SECRET`
- [x] Deploy en **Vercel** → https://adv-keeper.vercel.app, 16 variables en Production, GitHub conectado (cada merge a `main` despliega). Probado en producción: chat con Claude → hold → pago firmado → cita confirmada; firma falsa → 401; cron `demo-reset` con secreto
- [x] Decidir el plan de Vercel → **Hobby (gratis)**: `vercel.json` solo tiene el cron diario `demo-reset`; los crons frecuentes irán en Supabase `pg_cron` + `pg_net` (track D). Regla: preconstruir a costo 0
- [ ] Ensayar `docs/demo-pitch.md` de punta a punta en el teléfono, incluido el login de la dueña (👤, en paralelo al M2)
- [ ] Compartir credenciales demo con los primeros prospectos (👤, en paralelo al M2)

## 3. Hito M2 — Primer negocio en vivo ⏳ en curso
### Trámites — 👤 (empezar YA, tardan semanas). Costo 0: todo con cuentas gratis, número de prueba de Meta y sandbox
- [ ] **Google Cloud**: proyecto + pantalla de consentimiento OAuth + **iniciar la verificación** (el scope de calendario es sensible). Hace falta dominio, política de privacidad y video demo
- [ ] **Meta**: app de desarrollador + WhatsApp Cloud API; con el primer cliente: Business verificado, número dedicado y aprobación de plantillas (`day_before_reminder`, `deposit_link`, `package_nudge`, `reactivation`)
- [ ] **Azul / Cardnet**: averiguar el proceso de afiliación a e-commerce (página de pago hospedada) y conseguir credenciales **sandbox** para probar
- [ ] Dominio propio para Keeper + política de privacidad + términos de uso

### Construcción — 🤖
El track D se divide en 4 (archivos disjuntos, prompts en `tasks/parallel-prompts.md`). Se construyen contra la documentación pública con `fetch` mockeado, así que no hacen falta credenciales:
- [ ] **D1 · WhatsApp** (`feat/live-whatsapp`): adapter Cloud API, webhook entrante → `handleClientMessage`, plantillas en `src/lib/notifications/templates.ts`
- [ ] **D2 · Google Calendar** (`feat/live-google-calendar`): OAuth start/callback, token cifrado (`src/lib/crypto.ts`), adapter freeBusy + eventos
- [ ] **D3 · Pagos** (`feat/live-payments`): adapters Azul y Cardnet (página hospedada + verificación de hash), `/api/pay/[provider]/[linkId]`
- [ ] **D4 · Crons + cableado** (`feat/live-crons`, **después** de D1–D3): holds-expiry y reminders en `pg_cron`, package-nudges y reactivation-scan en `vercel.json`, `registerLiveAdapters` en `src/lib/adapters/live.ts`
- [ ] Validar el hash/callback de Azul o Cardnet contra la documentación oficial cuando lleguen las credenciales

### Onboarding del primer cliente — 👤
- [ ] Seguir `docs/onboarding-negocio.md`
- [ ] Checklist P0 de `docs/deploy.md` (probar RLS con dos negocios, alertas de error, timeouts)
- [ ] Prueba real: reserva → pago de anticipo pequeño → 💰 en agenda → evento en Google → recordatorio

## 4. Negocio — 👤
- [ ] Definir precio/planes de Keeper (mensualidad por negocio, ¿setup fee?)
- [ ] Cómo cobrarle a los negocios (billing de Keeper, fuera del alcance actual)
- [ ] Lista de 10–20 spas/salones objetivo para pitchear
- [ ] Contrato simple: los anticipos van directo a la cuenta del negocio; Keeper no toca dinero

## 5. v2 (después del primer cliente) — 🤖
- [ ] Varias cabinas/profesionales por negocio (hoy: un recurso)
- [ ] Vender paquetes con link de pago desde el chat
- [ ] Métricas: no-show, conversión chat→reserva, ingresos por anticipos
- [ ] Reprogramar citas desde el chat (hoy la cancelación va a la dueña)

---

### Notas / riesgos
- Seguimientos del M1 (antes del primer cliente real): cancelar una cita en hold desde el dashboard deja abierto el link de pago (la dueña solo puede leer `deposits` bajo RLS); el texto de "Reenganchar" debe alinearse con la plantilla aprobada de WhatsApp (track D); una dueña con varios negocios siempre ve el más antiguo.
- El repo en GitHub es **público**. Nunca subas `.env.local`; ya está ignorado. Considera hacerlo privado antes de tener clientes.
- ~~La migración todavía no se ha probado contra un Postgres real~~ → aplicada en Supabase y validada por `npm run seed:demo` (2026-09-30).
- En producción, las holds de 30 min dependen del cron de expiración en `pg_cron` (track D). Las holds de la demo también vencen a los 30 min (el cron solo cambia estados, no envía mensajes).
- Vercel Hobby es solo para uso no comercial: al cobrarle al primer cliente hay que pasar a Pro (o a otro host).
