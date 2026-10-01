import { htmlResponse, renderGatewayForm, renderPayPage } from "../../_lib/html";
import { prepareHandoff } from "../../_lib/pay-flow";
import { payFlowDeps } from "../../_lib/wiring";

/**
 * The deposit link the client receives (`APP_URL/api/pay/<provider>/<linkId>`). Shows a friendly page
 * when the link is paid or expired; otherwise hands the browser to the business's gateway.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/pay/[provider]/[linkId]">): Promise<Response> {
  const { provider, linkId } = await ctx.params;
  try {
    const outcome = await prepareHandoff(payFlowDeps(), provider, linkId);
    if (outcome.kind === "form") return htmlResponse(renderGatewayForm(outcome.form.action, outcome.form.fields, outcome.gatewayName));
    return htmlResponse(renderPayPage(outcome.page), outcome.status);
  } catch (error) {
    console.error("[pay] handoff failed", { provider, error: error instanceof Error ? error.message : String(error) });
    return htmlResponse(renderPayPage({ kind: "error" }), 500);
  }
}
