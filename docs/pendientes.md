# Pendientes — Keeper

_Última actualización: 2026-10-01. Arranque ✅ · M1 ✅ (demo en https://adv-keeper.vercel.app) · **M2: código ✅ e infraestructura ✅; falta validar con credenciales reales y preparar el alta del primer cliente.** Todo a costo 0._

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
- [x] Ensayar la demo de punta a punta (👤): probada y lista para pitch
- [ ] Compartir credenciales demo con los primeros prospectos (👤, en paralelo al M2)

## 3. Hito M2 — Primer negocio en vivo ⏳
### ✅ Código (PRs #9–#14, 264 tests, todo desplegado)
- [x] **Núcleo** (#9): credenciales por negocio cifradas (AES-256-GCM) en `integrations`, índice de dedupe de WhatsApp
- [x] **D1 · WhatsApp** (#11): canal Cloud API, webhook firmado → chat, dedupe, plantillas + `docs/whatsapp-templates.md`
- [x] **D2 · Google Calendar** (#10): OAuth con `state` firmado, token cifrado, freeBusy + eventos, aviso de desconexión
- [x] **D3 · Pagos** (#12): Azul Payment Page + Cardnet checkout, link propio `/api/pay/...`, verificación de hash/estado (⚠️ supuestos marcados)
- [x] **D4 · Cableado + crons** (#13): adapters live por negocio con degradación elegante, 4 crons idempotentes, `.env.example` limpio
- [x] Holds de la demo vencen a los 30 min (#14)

### ✅ Infraestructura (costo 0)
- [x] Migración de `integrations` aplicada y verificada en Supabase
- [x] Secretos en Supabase Vault (`keeper_app_url`, `keeper_cron_secret`)
- [x] `pg_cron`: holds cada 10 min y recordatorios cada hora → verificado (pg_cron → Vercel 200 a las 03:00 UTC)
- [x] Vercel: variables en Production **y Preview**; crons diarios/semanales en `vercel.json`

### 👤 Trámites (costo 0)
- [ ] **Google Cloud**: proyecto, Calendar API, consentimiento OAuth en modo Testing, scopes `calendar.events`, `calendar.freebusy`, `openid`, `email`, cliente web con redirect `https://adv-keeper.vercel.app/api/integrations/google/callback` → `GOOGLE_CLIENT_ID/SECRET` en `.env.local`
- [ ] **Meta**: app + WhatsApp, número de prueba, token permanente (System User), app secret, verify token → `WHATSAPP_*` en `.env.local`
- [ ] **Azul / Cardnet** → **pospuesto al primer cliente**: cada spa es el comercio y recibe sus credenciales al afiliarse. Pedirle que inicie la afiliación el mismo día que firme
- [ ] Dominio propio + política de privacidad + términos (**primer costo**, ~US$10/año; lo exige la verificación de Google para salir de Testing)

### 🤖 Con credenciales reales (cuando lleguen)
- [ ] Subir `GOOGLE_*` y `WHATSAPP_*` a Vercel (Production + Preview)
- [ ] Meta: webhook `https://adv-keeper.vercel.app/api/webhooks/whatsapp` + suscribir `messages`; enviar las 4 plantillas de `docs/whatsapp-templates.md`
- [ ] Validar Google: conectar, freeBusy real, crear/borrar evento, revocar → aviso "reconectar"
- [ ] Validar WhatsApp: mensaje real → una sola respuesta; plantilla real cuando Meta la apruebe
- [ ] Validar Azul/Cardnet con el sandbox del primer cliente (los ⚠️ del PR #12: orden del hash, codificación, campos de retorno, URL de producción de Cardnet)

### 🤖 Antes del primer cliente (huecos conocidos) — PRs abiertos, verificados juntos (278 tests + build)
- [x] **Alta de negocio** → `npm run onboard` (create · set-payments · set-whatsapp · status · go-live · pause), credenciales cifradas por negocio; probado contra Supabase real (PR #16)
- [x] `docs/onboarding-negocio.md` reescrito alrededor del CLI, con las URLs de pago corregidas (PR #16)
- [x] Cancelar un hold desde la agenda vence su anticipo pendiente (PR #17). Las páginas de pago ya rechazaban la cita cancelada
- [x] Reconciliación: antes de vencer un hold de **Cardnet** se consulta la pasarela y, si está pagado, se confirma (PR #18). **Azul** no tiene consulta de estado: un pago tardío queda como `late_payment` para la dueña
- [x] `/ajustes` muestra "Google conectado" o el motivo del error (PR #19)
- [x] Clientas nuevas por WhatsApp toman su nombre de perfil (PR #20)
- [ ] Aceptados por ahora: llave de sesión de Cardnet en columna propia (hoy cifrada en `activity_log`; cambio de núcleo); posible doble envío de WhatsApp si Meta acepta y responde 5xx; dueña con varios negocios (v2)

### 👤 Onboarding del primer cliente
- [ ] Seguir `docs/onboarding-negocio.md` con `npm run onboard`
- [ ] Checklist P0 de `docs/deploy.md` (RLS con dos negocios ✅ probado en M1, alertas de error, timeouts)
- [ ] Prueba real: reserva → anticipo pequeño → 💰 en agenda → evento en Google → recordatorio por WhatsApp

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
- Las holds de 30 min (live y demo) las vence `pg_cron` cada 10 min. Si se pausa el cron, los horarios quedan bloqueados.
- Supabase free pausa el proyecto tras ~7 días sin actividad; el reset diario y `pg_cron` lo mantienen activo.
- Vercel Hobby es solo para uso no comercial: al cobrarle al primer cliente hay que pasar a Pro (o a otro host).
