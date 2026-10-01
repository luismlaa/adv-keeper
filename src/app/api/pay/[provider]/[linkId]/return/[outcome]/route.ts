import { htmlResponse, renderPayPage } from "../../../../_lib/html";
import { handleGatewayReturn } from "../../../../_lib/pay-flow";
import { payFlowDeps } from "../../../../_lib/wiring";

type Ctx = RouteContext<"/api/pay/[provider]/[linkId]/return/[outcome]">;

/** Gateways return the browser by redirect (query string) or by form post; both carry untrusted fields. */
async function readFields(request: Request): Promise<URLSearchParams> {
  const fields = new URL(request.url).searchParams;
  if (request.method !== "POST") return fields;
  const body = new URLSearchParams(await request.text());
  body.forEach((value, key) => {
    if (!fields.has(key)) fields.set(key, value);
  });
  return fields;
}

async function handle(request: Request, ctx: Ctx): Promise<Response> {
  const { provider, linkId, outcome } = await ctx.params;
  try {
    const result = await handleGatewayReturn(payFlowDeps(), { provider, linkId, outcome, fields: await readFields(request) });
    return htmlResponse(renderPayPage(result.page), result.status);
  } catch (error) {
    // Nothing was marked paid; every side effect is idempotent, so reloading the page retries safely.
    console.error("[pay] return failed", { provider, error: error instanceof Error ? error.message : String(error) });
    return htmlResponse(renderPayPage({ kind: "error" }), 500);
  }
}

export const GET = handle;
export const POST = handle;
