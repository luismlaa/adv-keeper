# Onboarding de un negocio (go-live)

Tiempo típico: **1–3 semanas**, casi todo esperando aprobaciones de terceros. Arranca los pasos 2–4 el mismo día que el negocio firma.

Todo se hace con el CLI `npm run onboard` (usa `.env.local`, service role). Para ver qué falta en cualquier momento:

```bash
npm run onboard -- status --slug <slug>
```

## 0. Contrato
- [ ] Plan y precio acordados. El negocio acepta que los anticipos van directo a **su** cuenta de Azul o Cardnet: Keeper nunca toca el dinero.

## 1. Tenant (día 1, ~30 min)
- [ ] Crear el negocio y la dueña:
  ```bash
  npm run onboard -- create --slug spa-luna --name "Spa Luna" --owner-email ana@spaluna.do
  ```
  - El negocio nace en **modo demo** con pagos falsos, así que nada llega a clientas reales hasta el go-live.
  - Si la usuaria no existía, el CLI muestra **una sola vez** su contraseña temporal. Compártela por un canal privado.
- [ ] Con su login en `/login`, la dueña (o tú con ella) carga desde el dashboard:
  - **Servicios:** nombre, duración, precio en RD$ y anticipo fijo opcional.
  - **Paquetes:** sesiones, precio e intervalo en días.
  - **Ajustes:** horario, % de anticipo, mínimo, minutos de hold, semanas para reactivar, y el tono y nombre que usa la dueña.
- [ ] Importar clientas existentes (nombre, teléfono E.164, última visita), si las tiene. Por ahora esto es manual.

## 2. WhatsApp Cloud API (3–10 días)
- [ ] El Meta Business Manager del negocio debe estar **verificado**.
- [ ] Número dedicado. No puede estar activo en la app normal de WhatsApp.
- [ ] Agregar el número a la app de Keeper en developers.facebook.com. El token permanente (System User) es global: `WHATSAPP_TOKEN`.
- [ ] Webhook (una sola vez para todos los negocios): `https://adv-keeper.vercel.app/api/webhooks/whatsapp`, con verify token = `WHATSAPP_VERIFY_TOKEN`, suscrito al campo `messages`.
- [ ] Asociar el número al negocio:
  ```bash
  npm run onboard -- set-whatsapp --slug spa-luna --phone-number-id 123456789012345
  ```
- [ ] **Plantillas:** el texto exacto, la categoría y los ejemplos están en `docs/whatsapp-templates.md`. Son `day_before_reminder`, `deposit_link` y `package_nudge` (Utility), y `reactivation` (Marketing), en idioma `es`. Hay que esperar la aprobación.

## 3. Pagos: Azul o Cardnet (1–3 semanas)
- [ ] El negocio solicita al banco adquirente la afiliación de comercio electrónico (Payment Page o checkout hospedado).
- [ ] Con las credenciales de **sandbox**, crea un JSON **fuera del repo** (por ejemplo `../secrets/spa-luna-azul.json`):
  - Azul: `{ "merchantId": "...", "merchantName": "...", "authKey": "...", "terminalId": "00000001" }` (`merchantType` es opcional; por defecto `ECommerce`).
  - Cardnet: `{ "merchantNumber": "...", "merchantTerminal": "...", "merchantName": "...", "merchantType": "7997" }`.
- [ ] Cargarlo. Se valida y se guarda **cifrado** por negocio:
  ```bash
  npm run onboard -- set-payments --slug spa-luna --provider azul --credentials ../secrets/spa-luna-azul.json
  ```
  Después borra el JSON.
- [ ] No hay que configurar URLs de retorno en el portal: Keeper las envía en cada pago (`https://adv-keeper.vercel.app/api/pay/<azul|cardnet>/<linkId>/return/<resultado>`).
- [ ] Prueba de punta a punta en sandbox, validando los supuestos ⚠️ del PR #12: orden del hash, codificación, campos de retorno y URL de producción de Cardnet.
- [ ] Con las credenciales de **producción**, repite `set-payments`. Sobrescribe las anteriores.

## 4. Google Calendar (día 1)
- [ ] La dueña entra a **Ajustes → "Conectar Google Calendar"**. Es opcional: sin Google se reserva igual, pero no se crean eventos ni se leen bloqueos.
- [ ] ⚠️ El scope de calendario es **sensible**. Mientras la app OAuth esté en modo *testing*, agrega a la dueña como test user (máximo 100). En ese modo la conexión vence a los 7 días y hay que reconectar. La verificación de Google pide dominio propio, política de privacidad y video demo, y tarda semanas.

## 5. Go-live
- [ ] Revisar y activar. El CLI se niega si falta la dueña, los servicios, las credenciales de pago o WhatsApp; Google solo genera aviso:
  ```bash
  npm run onboard -- status  --slug spa-luna
  npm run onboard -- go-live --slug spa-luna
  ```
- [ ] Prueba real: reserva desde un teléfono → link → pagar un anticipo bajo → ver 💰 en la agenda → evento en Google Calendar → recordatorio al día siguiente.
- [ ] Entregar a la dueña: el link del dashboard, el número de WhatsApp para compartir y un QR o link para Instagram.
- [ ] Revisión a la semana: no-shows, tasa de pago de anticipos y conversaciones escaladas.
- Si algo sale mal: `npm run onboard -- pause --slug spa-luna` vuelve a modo demo sin borrar nada. Se detienen los crons y los adapters live de ese negocio.
