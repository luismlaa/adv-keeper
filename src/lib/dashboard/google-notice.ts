export interface GoogleNotice {
  tone: "success" | "error";
  text: string;
}

/** Owner-facing Spanish copy for the `reason` codes the Google OAuth routes redirect with. */
const REASONS: Readonly<Record<string, string>> = {
  denied: "Cancelaste el permiso en Google. Vuelve a intentarlo y acepta el acceso al calendario.",
  missing_scopes: "Google no dio todos los permisos. Al conectar, marca las casillas del calendario.",
  missing_refresh_token: "Google no entregó un acceso permanente. Quita Keeper en myaccount.google.com/permissions y conecta de nuevo.",
  expired: "El intento de conexión venció. Vuelve a tocar «Conectar Google Calendar».",
  not_configured: "La conexión con Google todavía no está habilitada en Keeper. Escríbenos y la activamos.",
  demo: "La cuenta demo no se puede conectar a un Google Calendar real.",
  not_owner: "Solo la dueña del negocio puede conectar Google Calendar.",
  no_business: "Tu usuario no tiene un negocio asociado.",
  exchange_failed: "Google no respondió bien. Inténtalo de nuevo en unos minutos.",
};

const GENERIC_ERROR = "No se pudo conectar Google Calendar. Vuelve a intentarlo.";

/** Notice shown in Ajustes after the OAuth round trip (`?google=conectado|error&reason=`). */
export function googleConnectNotice(params: Record<string, string | string[] | undefined>): GoogleNotice | null {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const google = first(params.google);
  if (google === "conectado") return { tone: "success", text: "Google Calendar conectado. Keeper ya consulta tus horarios ocupados y agrega ahí las citas confirmadas." };
  if (google !== "error") return null;
  const reason = first(params.reason);
  return { tone: "error", text: (reason !== undefined && REASONS[reason]) || GENERIC_ERROR };
}
