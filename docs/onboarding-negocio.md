# Onboarding de un negocio (go-live)

Tiempo típico: **1–3 semanas**, casi todo esperando aprobaciones de terceros. Arranca los pasos 2–4 el mismo día que el negocio firma.

## 0. Contrato
- [ ] Plan y precio acordados; el negocio acepta que los anticipos van directo a SU cuenta de Azul/Cardnet (Keeper nunca toca el dinero).

## 1. Tenant (día 1, ~30 min)
- [ ] Crear `businesses` (slug, nombre, `integration_mode = 'demo'` mientras se configura).
- [ ] Invitar a la dueña (Supabase Auth → Invite) y crear su `memberships` con rol `owner`.
- [ ] Cargar servicios (nombre, duración, precio en centavos, anticipo fijo opcional), paquetes (sesiones, precio, intervalo en días) y horario.
- [ ] Ajustar `settings`: % de anticipo, mínimo, minutos de hold, semanas para reactivar, tono y nombre que usa la dueña.
- [ ] Importar clientas existentes (nombre, teléfono E.164, última visita) si las tiene.

## 2. WhatsApp Cloud API (3–10 días)
- [ ] Meta Business Manager del negocio **verificado**.
- [ ] Número dedicado (no puede estar activo en la app de WhatsApp normal).
- [ ] App en developers.facebook.com → WhatsApp → agregar número → token permanente (System User).
- [ ] Webhook: `https://<APP_URL>/api/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`, suscribir `messages`.
- [ ] Guardar `whatsapp_phone_number_id` en el negocio.
- [ ] **Plantillas** (categoría Utility, idioma es): `day_before_reminder`, `deposit_link`, `package_nudge`; y `reactivation` (categoría Marketing). Esperar aprobación.

## 3. Pagos: Azul o Cardnet (1–3 semanas)
- [ ] El negocio solicita afiliación de comercio electrónico (Payment Page / checkout hospedado) a su banco adquirente.
- [ ] Recibir credenciales de **sandbox** → probar link + confirmación de punta a punta.
- [ ] Configurar URLs de respuesta/callback hacia `https://<APP_URL>/api/webhooks/payments/<azul|cardnet>`.
- [ ] Recibir credenciales de **producción**; `payment_provider` = `azul` | `cardnet`.
- Nota: los detalles exactos de firma/hash y callback se validan contra la documentación que entrega el adquirente con las credenciales.

## 4. Google Calendar (día 1)
- [ ] La dueña entra a Ajustes → "Conectar Google Calendar" y elige el calendario.
- [ ] ⚠️ El scope de calendario es **sensible**: mientras la app OAuth esté en modo *testing*, agrega a la dueña como test user (máx. 100). Inicia **ya** la verificación de Google de la app OAuth (logo, dominio, política de privacidad, video demo); tarda semanas.

## 5. Go-live
- [ ] `integration_mode = 'live'`.
- [ ] Prueba real: reserva desde un teléfono → link → pagar anticipo bajo → ver 💰 en la agenda → evento en Google Calendar → recordatorio al día siguiente.
- [ ] Entregar a la dueña: link del dashboard, el número de WhatsApp para compartir, y un QR/link para Instagram.
- [ ] Revisión a la semana: no-shows, tasa de pago de anticipo, conversaciones escaladas.
