/**
 * Minimal server-rendered pages for the payment hand-off (route handlers return HTML directly, so the
 * gateway round trip needs no client JS beyond the auto-submit). Every interpolated value is escaped.
 */

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const STYLE = `
:root{color-scheme:light;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#f4f4f5;color:#18181b;padding:40px 16px;box-sizing:border-box}
.card{width:100%;max-width:28rem;background:#fff;border-radius:16px;box-shadow:0 10px 25px rgba(0,0,0,.08);padding:24px;text-align:center;display:flex;flex-direction:column;gap:16px}
h1{font-size:1.5rem;margin:0}
p{margin:0;font-size:.875rem;color:#52525b;line-height:1.5}
.badge{margin:0 auto;width:64px;height:64px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:2rem}
.ok{background:#d1fae5}.warn{background:#fef3c7}
.btn{display:flex;align-items:center;justify-content:center;height:48px;border-radius:12px;background:#18181b;color:#fff;font-weight:600;text-decoration:none;border:0;font-size:1rem;cursor:pointer;width:100%}
.muted{font-size:.75rem;color:#71717a}
`;

function document(title: string, body: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)} · Keeper</title><style>${STYLE}</style></head><body><main class="card">${body}</main></body></html>`;
}

export interface PayPageContext {
  businessName: string;
  amountLabel: string;
  /** Our own hand-off URL, offered as "try again" when the payment did not go through. */
  retryUrl?: string;
}

export type PayPage =
  | { kind: "paid"; confirmed: boolean; context: PayPageContext }
  | { kind: "expired"; context: PayPageContext }
  | { kind: "not_completed"; context: PayPageContext }
  | { kind: "unverified"; context: PayPageContext }
  | { kind: "unavailable"; context: PayPageContext }
  | { kind: "not_found" }
  | { kind: "error" };

const retryButton = (url: string | undefined, label: string) =>
  url === undefined ? "" : `<a class="btn" href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;

export function renderPayPage(page: PayPage): string {
  if (page.kind === "not_found") {
    return document("Link no encontrado", `<h1>Este link de pago no existe</h1><p>Revisa el mensaje que te enviamos o escríbenos para que te mandemos uno nuevo.</p>`);
  }
  if (page.kind === "error") {
    return document("Algo salió mal", `<h1>Algo salió mal</h1><p>Si ya pagaste, tu pago no se pierde: recarga la página en un momento o escríbenos.</p>`);
  }
  const c = page.context;
  const business = escapeHtml(c.businessName);
  const amount = escapeHtml(c.amountLabel);
  switch (page.kind) {
    case "paid":
      return document(
        page.confirmed ? "Cita confirmada" : "Pago recibido",
        `<div class="badge ok" aria-hidden="true">✓</div><h1>${page.confirmed ? "¡Cita confirmada!" : "Pago recibido"}</h1><p>${
          page.confirmed
            ? `Tu anticipo de ${amount} quedó registrado. ${business} te espera.`
            : `Recibimos tu anticipo de ${amount}. ${business} te escribirá para confirmar el horario.`
        }</p>`,
      );
    case "expired":
      return document(
        "Link vencido",
        `<h1>Este link venció</h1><p>El horario se liberó porque el anticipo no se pagó a tiempo. Escríbele a ${business} y te apartamos otro.</p>`,
      );
    case "not_completed":
      return document(
        "Pago no completado",
        `<div class="badge warn" aria-hidden="true">!</div><h1>El pago no se completó</h1><p>No se cobró nada. Tu horario sigue apartado por ahora: puedes intentarlo de nuevo.</p>${retryButton(c.retryUrl, `Pagar ${c.amountLabel}`)}`,
      );
    case "unverified":
      return document(
        "No pudimos verificar el pago",
        `<div class="badge warn" aria-hidden="true">!</div><h1>No pudimos verificar el pago</h1><p>Si se hizo un cobro, ${business} lo revisará y te escribirá. Si no, puedes intentarlo de nuevo.</p>${retryButton(c.retryUrl, "Intentar de nuevo")}`,
      );
    case "unavailable":
      return document(
        "Pasarela no disponible",
        `<div class="badge warn" aria-hidden="true">…</div><h1>Estamos confirmando tu pago</h1><p>La pasarela de pago no respondió a tiempo. Espera un momento y vuelve a intentarlo.</p>${retryButton(c.retryUrl, "Reintentar")}`,
      );
  }
}

/** Auto-submitting POST to the gateway's hosted page. Fields are gateway parameters, never card data. */
export function renderGatewayForm(action: string, fields: Readonly<Record<string, string>>, gatewayName: string): string {
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("");
  return document(
    "Redirigiendo al pago",
    `<h1>Te llevamos a ${escapeHtml(gatewayName)}</h1><p>Vas a pagar en la página segura de ${escapeHtml(gatewayName)}. Keeper nunca ve tu tarjeta.</p><form id="gateway" method="post" action="${escapeHtml(action)}">${inputs}<button class="btn" type="submit">Continuar al pago</button></form><p class="muted">Si no avanza solo, toca “Continuar al pago”.</p><script>document.getElementById("gateway").submit();</script>`,
  );
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
    },
  });
}
