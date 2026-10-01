import { after } from "next/server";
import { createWhatsAppChannel } from "@/lib/adapters/whatsapp/channel";
import { SupabaseWhatsAppRepo } from "@/lib/adapters/whatsapp/repo";
import { SIGNATURE_HEADER } from "@/lib/adapters/whatsapp/signature";
import { handleWebhookGet, handleWebhookPost, type InboundDeps } from "@/lib/adapters/whatsapp/webhook";
import { handleClientMessage } from "@/lib/chat/handle-message";
import { getServerEnv, requireEnv } from "@/lib/config/env";
import { createAdminClient } from "@/lib/db/admin";
import { SupabaseStore } from "@/lib/store/supabase";

/** Room for one concierge turn (Claude + tools) plus the Graph API reply, run inside `after()`. */
export const maxDuration = 60;

const log = (event: string, meta: Record<string, unknown>) => console.info(`[whatsapp-webhook] ${event}`, JSON.stringify(meta));

/** Meta subscription handshake (`hub.mode=subscribe`). */
export async function GET(request: Request): Promise<Response> {
  return handleWebhookGet(new URL(request.url).searchParams, getServerEnv().WHATSAPP_VERIFY_TOKEN);
}

/** Inbound WhatsApp messages: verify signature → 200 immediately → reply in `after()`. */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const env = getServerEnv();

  // Creating the client does no I/O; the DB is only touched inside `work` (after a valid signature).
  const db = createAdminClient(env);
  const deps: InboundDeps = {
    repo: new SupabaseWhatsAppRepo(db),
    store: new SupabaseStore(db),
    handleMessage: (input) => handleClientMessage(input),
    channelFor: (_business, phoneNumberId) => {
      const { WHATSAPP_TOKEN } = requireEnv(env, ["WHATSAPP_TOKEN"], "WhatsApp");
      return createWhatsAppChannel({ token: WHATSAPP_TOKEN, graphVersion: env.WHATSAPP_GRAPH_VERSION, phoneNumberId });
    },
    log,
  };

  const { response, work } = handleWebhookPost(deps, {
    rawBody,
    signature: request.headers.get(SIGNATURE_HEADER),
    appSecret: env.WHATSAPP_APP_SECRET,
  });
  if (work !== null) {
    after(async () => {
      try {
        await work();
      } catch (error) {
        log("work_failed", { error: error instanceof Error ? error.message : String(error) });
      }
    });
  }
  return response;
}
