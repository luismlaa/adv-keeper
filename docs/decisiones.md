# Decisiones y glosario — Keeper

Este archivo guarda el *porqué* del proyecto: decisiones, glosario del dominio y contexto. Está en el repo para que cualquier dispositivo o sesión lo tenga. Es la versión compartible de la memoria local de Claude Code (`~/.claude/projects/<proyecto>/memory/`). Si cambia una decisión, actualiza **ambos**. No pongas secretos aquí: el repo es público.

Estado y tareas pendientes: `docs/pendientes.md`. Arquitectura y reglas: `CLAUDE.md`.

---

## Decisiones

### 1. Stack y tenancy (2026-09-28)
- **Un solo repo TypeScript:** Next.js 16 (App Router), Supabase (Postgres, Auth, RLS) y el SDK de Anthropic, desplegado en Vercel.
- **SaaS multi-tenant:** cada fila lleva `business_id` y RLS con `is_member()`. No hay una instancia por cliente, así que dar de alta un negocio es un tema de datos, no de infraestructura.
- **Un solo agente** (el concierge) con herramientas. No hay orquestación multi-agente.
- **Integraciones detrás de puertos:** `CalendarProvider`, `PaymentProvider` y `MessagingChannel`. El tenant demo (`integration_mode = 'demo'`) usa adapters falsos con Claude real, para poder hacer pitch sin aprobaciones de terceros.
- **Calendario:** solo Google Calendar (elección del dueño; no Cal.com). **Pagos:** solo páginas hospedadas de Azul o Cardnet. **Canal de producción:** WhatsApp Cloud API. El chat web existe para la demo.
- **Aprobación de la dueña:** obligatoria para descuentos, precios fuera de menú, cancelaciones y reembolsos. Reenganchar a una clienta no necesita aprobación, porque el clic de la dueña ya lo es.
- **Un recurso por negocio en el MVP:** lo garantiza la restricción de exclusión `appointments_no_overlap`. Varias cabinas o profesionales es v2.
- **Gestor de paquetes:** npm, no pnpm.
- **Flujo de trabajo:** rama, PR y merge humano. Para trabajos grandes, tracks en paralelo en worktrees (`tasks/parallel-prompts.md`).

### 2. Preconstruir a costo 0 (2026-09-30)
Hasta el primer cliente que pague, toda la infraestructura debe ser gratis:
- Vercel Hobby y Supabase en plan free.
- Crons de menos de un día en Supabase `pg_cron` + `pg_net`, nunca en Vercel Pro.
- Credenciales de prueba o sandbox para Meta, Google, Azul y Cardnet.

Si algo exige un plan pago, primero se propone la alternativa gratis y se marca el costo. Avisos para el lanzamiento:
- **Vercel Hobby es solo para uso no comercial:** al cobrarle al primer cliente hay que pasar a Pro, a US$20/mes.
- **Supabase free pausa el proyecto tras ~7 días sin actividad.** El reset diario y `pg_cron` lo mantienen activo.
- **El primer gasto inevitable es el dominio propio** (~US$10/año): lo exige la verificación de Google OAuth.

### 3. Cada spa es su propio comercio (2026-09-30)
- Cada negocio se afilia por su cuenta a Azul o Cardnet, y los anticipos van directo a su cuenta bancaria. **Keeper nunca toca el dinero.**
- Las credenciales del comercio se guardan **por negocio y cifradas** (AES-256-GCM, `integrations.encrypted_credentials`, a través de `IntegrationCredentials`). Se cargan con `npm run onboard -- set-payments`. Nunca van en variables de entorno globales; esas solo guardan URLs de las pasarelas.
- Los adapters de pago se construyeron contra la documentación pública. Se validan con el sandbox del **primer cliente**, y conviene pedirle que inicie la afiliación el mismo día que firme, porque la certificación tarda semanas.
- **Azul** no tiene consulta de estado de pago: un pago que llega tarde queda como `late_payment` para la dueña. **Cardnet** sí se reconcilia antes de vencer el hold.

---

## Glosario del dominio

### Anticipo, hold y ciclo de vida de la cita
- **Anticipo:** depósito que se paga con un link hospedado (Azul o Cardnet) para asegurar la cita. Se calcula en el servidor:
  - `percent` del precio, redondeado hacia arriba a `roundToMinor`;
  - nunca por debajo de `minimumMinor` ni por encima del precio;
  - un `deposit_override_minor` del servicio tiene prioridad sobre el porcentaje.

  Todo el dinero se maneja en **centavos enteros**. El precio sale siempre del catálogo, nunca del modelo ni del cliente.
- **Hold** (`hold_pending_deposit`): reserva el horario durante `holdMinutes` (30 por defecto) mientras la clienta paga. Si no paga, pasa a `expired` y el horario se libera; lo hace el cron `holds-expiry` cada 10 minutos, también en la demo.
- **Ciclo de vida:**
  - `hold_pending_deposit → confirmed` (anticipo pagado o sesión de paquete) `→ completed | no_show | cancelled`
  - `hold → expired | cancelled`

  Ver `src/lib/domain/appointment-state.ts`.
- **Pago tardío:** si el pago llega cuando la cita ya no es un hold, **no se confirma solo**. Queda como `late_payment` y la dueña decide si reagenda o reembolsa. Cancelar un hold desde la agenda vence su anticipo pendiente.
- **Badges de la agenda:** 💰 pagado · ⏳ pendiente · 📦 paquete.

### Paquetes, nudges y reactivación
- **Plantilla de paquete** (`package_templates`): por ejemplo "Láser piernas · 10 sesiones", con `sessions_total`, precio e `interval_days` (separación recomendada entre sesiones).
- **Paquete de la clienta** (`client_packages`): lo que compró, con `sessions_used` sobre `sessions_total`.
  - La sesión se consume **solo cuando una cita enlazada se marca como completada**, no al agendarla.
  - El paquete pasa a `completed` con la última sesión.
  - Las sesiones ya están pagadas, así que agendar con paquete **no pide anticipo** y se confirma al instante.
- **Nudge de paquete** ("te toca la sesión N de M, ¿agendamos?"): se envía cuando se cumplen todas estas condiciones:
  - el paquete está activo;
  - la clienta no tiene nada agendado;
  - pasaron `interval_days` desde su última sesión;
  - no se le avisó desde que le tocó.
- **Reactivación:** una clienta es candidata cuando se cumplen todas estas condiciones:
  - su última visita fue hace `reactivationWeeks` o más (6 por defecto);
  - no tiene nada próximo;
  - no se la reenganchó en los últimos `reengagementCooldownDays` (14);
  - lleva menos de un año sin venir.

  Un trigger de la base actualiza `clients.last_visit_at` cuando una cita se marca como completada. El cron semanal solo arma un resumen para la dueña; **nunca escribe a las clientas por su cuenta**.

### Mensajes de WhatsApp
- Los mensajes que inicia el negocio (recordatorios, links de anticipo fuera de las 24 h, nudges, reactivación) **deben usar plantillas aprobadas por Meta**. El texto de cada una está en `docs/whatsapp-templates.md`.

---

## Contexto del MVP
- **Objetivo:** que los prospectos entren a un **tenant demo** ("Spa Demo · Keeper", slug `spa-demo`) con una dueña de prueba para explorar la plataforma, y usarlo en reuniones de pitch (guion: `docs/demo-pitch.md`). Vender va antes que las integraciones reales, porque cada aprobación de WhatsApp, pasarela o Google tarda de 1 a 3 semanas por negocio.
- **La demo:** usa adapters falsos y Claude real. Los datos se regeneran relativos a "ahora" y se resetean cada noche (cron `demo-reset`, que también restablece la contraseña demo). El gasto en Claude está limitado por `DEMO_MAX_MESSAGES_PER_SESSION` y `DEMO_DAILY_MESSAGE_BUDGET`.
- **Hitos:**
  - **M1:** demo lista para pitch (chat, dashboard, experiencia demo y deploy). ✅ Terminado.
  - **M2:** primer negocio en vivo (WhatsApp, Google, Azul/Cardnet, crons, alta con `npm run onboard`). Código e infraestructura ✅. Falta validar con credenciales reales y hacer el onboarding del primer cliente.
- **Producción:** https://adv-keeper.vercel.app (Vercel Hobby, cada merge a `main` despliega).
