# Pendientes — Keeper

_Última actualización: 2026-09-30. Fase 0 mergeada (PR #1). Arranque ✅ completo: Supabase + migración aplicada, demo sembrada, `npm run check` en verde. **En curso: Hito M1** — tracks A, B y C corriendo en paralelo._

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

## 2. Hito M1 — Demo lista para pitch — 🤖 ⏳ en curso
Correr en paralelo, un worktree por tarea (comandos en `tasks/parallel-prompts.md`):
- [ ] **A · Chat de la clienta** (`feat/concierge-chat`): `/chat/spa-demo` con Claude real; guarda la conversación y respeta el límite de mensajes
- [ ] **B · Dashboard de la dueña** (`feat/owner-dashboard`): login, agenda día/semana 💰/⏳/📦, ficha de clienta con paquetes, reactivar, aprobaciones, servicios, ajustes
- [ ] **C · Experiencia demo** (`feat/demo-experience`): landing, `/demo` con entrada en un clic, checkout simulado, webhook de pagos, reset nocturno, tope de gasto de Claude
- [ ] Revisar y hacer merge de A, B y C (👤)
- [ ] Deploy en **Vercel** con variables de entorno + `APP_URL` de producción (👤)
- [ ] Decidir el plan de Vercel: **Pro** para crons cada 10 min/hora, o mover esos crons a Supabase `pg_cron` (👤)
- [ ] Ensayar `docs/demo-pitch.md` de punta a punta en el teléfono (👤)
- [ ] Compartir credenciales demo con los primeros prospectos (👤)

## 3. Hito M2 — Primer negocio en vivo
### Trámites — 👤 (empezar YA, tardan semanas)
- [ ] **Google Cloud**: proyecto + pantalla de consentimiento OAuth + **iniciar la verificación** (el scope de calendario es sensible). Hace falta dominio, política de privacidad y video demo
- [ ] **Meta**: app de desarrollador + WhatsApp Cloud API; con el primer cliente: Business verificado, número dedicado y aprobación de plantillas (`day_before_reminder`, `deposit_link`, `package_nudge`, `reactivation`)
- [ ] **Azul / Cardnet**: averiguar el proceso de afiliación a e-commerce (página de pago hospedada) y conseguir credenciales **sandbox** para probar
- [ ] Dominio propio para Keeper + política de privacidad + términos de uso

### Construcción — 🤖
- [ ] **D · Integraciones live** (`feat/live-integrations`, merge después de A): adapters de WhatsApp, Google Calendar OAuth, Azul y Cardnet; crons de recordatorios, nudges de paquetes, reactivación y expiración de holds
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
- El repo en GitHub es **público**. Nunca subas `.env.local`; ya está ignorado. Considera hacerlo privado antes de tener clientes.
- ~~La migración todavía no se ha probado contra un Postgres real~~ → aplicada en Supabase y validada por `npm run seed:demo` (2026-09-30).
- En producción, las holds de 30 min dependen del cron de expiración (ver la decisión Vercel Pro vs `pg_cron`).
