# WhatsApp message templates for Meta approval

Keeper sends these four templates when the business starts the conversation: reminders, deposit links sent outside the 24h window, package nudges and reactivation. Meta only lets a business message a client first through an **approved template**. Replies inside the 24h customer-service window are free-form text and need no template.

The source of truth in code is `src/lib/notifications/templates.ts`. **The text approved in Meta has to match the code exactly**, including emojis, punctuation and the order of `{{n}}`. If you change one, change the other and re-submit the template.

## How to submit them

WhatsApp Manager → **Message templates** → **Create template**. For each template below:

1. **Category**: the one listed for the template.
2. **Name**: copy it exactly (lowercase with underscores).
3. **Language**: Spanish, code **`es`**. Do not pick `es_MX`, `es_ES` or `es_AR`, because the code sends `es`.
4. **Variable type**: *Number*, so the placeholders are `{{1}}`, `{{2}}`, …
5. **Header / footer / buttons**: none. Body only.
6. **Body**: paste the text below as is.
7. **Sample values**: Meta asks for one example per variable. Use the ones in the table.

### Utility vs Marketing, in short

- **Utility**: tied to something the client already requested or bought (a booked appointment, a deposit for her booking, sessions of a package she paid for). It's cheaper, and in many cases free inside the service window.
- **Marketing**: invites her to come back or buy without an open transaction. It costs more, needs the client's *opt-in*, and Meta can limit how often it's delivered.
- Meta reviews the category and **can reclassify** a template. If it moves one from utility to marketing, nothing breaks in the code (the name doesn't change), but the cost does.

---

## 1. `day_before_reminder`

- **Category:** Utility. It's a reminder for an appointment the client booked herself.
- **Language:** `es`

**Body:**

```
Hola {{1}} 👋 Te recordamos tu cita de {{2}} en {{3}}: {{4}}. Si necesitas cambiarla, responde a este mensaje y te ayudamos.
```

| Variable | Meaning | Sample |
|---|---|---|
| `{{1}}` | Client's first name | María |
| `{{2}}` | Service | Limpieza facial |
| `{{3}}` | Business name | Spa Bella |
| `{{4}}` | Date and time (Santo Domingo) | martes, 7 de octubre, 10:00 a. m. |

## 2. `deposit_link`

- **Category:** Utility. It's the payment step for a booking the client requested, and the link is part of the transaction.
- **Language:** `es`

**Body:**

```
Hola {{1}}, te separamos {{2}} para el {{3}}. Para confirmar tu cita, paga el anticipo de {{4}} en este enlace seguro: {{5}} El espacio queda reservado por {{6}} minutos.
```

| Variable | Meaning | Sample |
|---|---|---|
| `{{1}}` | Client's first name | María |
| `{{2}}` | Service | Limpieza facial |
| `{{3}}` | Date and time | martes, 7 de octubre, 10:00 a. m. |
| `{{4}}` | Deposit amount | RD$750 |
| `{{5}}` | Payment link | https://adv-keeper.vercel.app/api/pay/azul/abc123 |
| `{{6}}` | Minutes the slot is held | 30 |

> The link goes in the body (not a URL button) because the domain changes by environment and gateway. Meta allows URLs in body variables.

## 3. `package_nudge`

- **Category:** Utility (Meta may reclassify it). The client already paid for the package, and the message tells her which session is due. We submit it as utility with neutral wording. If Meta marks it as marketing it still works, it just costs more.
- **Language:** `es`

**Body:**

```
Hola {{1}} 😊 Te toca la sesión {{2}} de {{3}} de tu paquete {{4}} en {{5}}. ¿Agendamos? Responde a este mensaje y te buscamos el horario que mejor te quede.
```

| Variable | Meaning | Sample |
|---|---|---|
| `{{1}}` | Client's first name | María |
| `{{2}}` | Session number that is due | 4 |
| `{{3}}` | Total sessions in the package | 10 |
| `{{4}}` | Package name | Láser piernas |
| `{{5}}` | Business name | Spa Bella |

## 4. `reactivation`

- **Category:** Marketing. It invites back a client with no open appointment or transaction (6+ weeks without a visit). It requires her consent to receive WhatsApp messages from the business.
- **Language:** `es`

**Body:**

```
¡Hola, {{1}}! Te extrañamos en {{2}} 💆‍♀️ ¿Te reservamos un espacio esta semana? Responde a este mensaje y te buscamos el horario que mejor te quede.
```

| Variable | Meaning | Sample |
|---|---|---|
| `{{1}}` | Client's first name | María |
| `{{2}}` | Business name | Spa Bella |

---

## Meta rules these texts already follow

- No variable at the very start or end of the body, and no two variables side by side.
- Variables numbered `{{1}}…{{n}}` in order, each used once.
- No line breaks, and under 1024 characters.
- The code never sends empty variables (it uses "clienta" when the name is unknown) and cleans up line breaks and repeated spaces in the values. Meta rejects both.
