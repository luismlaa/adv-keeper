import { cookies } from "next/headers";
import { z } from "zod";
import { getServerEnv } from "@/lib/config/env";
import { loadDisplayMessages } from "@/lib/chat/chat-view";
import { defaultChatDeps } from "@/lib/chat/deps";
import { handleClientMessage, MAX_CLIENT_TEXT_LENGTH } from "@/lib/chat/handle-message";
import { ChatError, LLM_UNAVAILABLE_MESSAGE, sessionLimitMessage } from "@/lib/chat/limits";
import { allocateWebPhone, chatCookieName, chatCookieOptions, signWebIdentity, verifyWebIdentity } from "@/lib/chat/web-identity";

const bodySchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  text: z.string().trim().min(1).max(MAX_CLIENT_TEXT_LENGTH),
});

const error = (status: number, code: string, reply: string) => Response.json({ error: code, reply }, { status });

/** POST { slug, text } → { reply, messages }. The web client is identified by a signed httpOnly cookie. */
export async function POST(request: Request) {
  const raw: unknown = await request.json().catch(() => null);
  const body = bodySchema.safeParse(raw);
  if (!body.success) return error(400, "invalid_input", "No pude leer tu mensaje. Escríbelo de nuevo, por favor.");

  const env = getServerEnv();
  const deps = defaultChatDeps();
  const business = await deps.store.getBusinessBySlug(body.data.slug);
  if (!business) return error(404, "business_not_found", "Este negocio no existe.");

  const cookieStore = await cookies();
  const cookieName = chatCookieName(business.slug);
  let phone = verifyWebIdentity(cookieStore.get(cookieName)?.value, env.ENCRYPTION_KEY);
  if (phone === null) {
    phone = await allocateWebPhone(async (candidate) => (await deps.conversations.findClientIdByPhone(business.id, candidate)) !== null);
    cookieStore.set(cookieName, signWebIdentity(phone, env.ENCRYPTION_KEY), {
      ...chatCookieOptions,
      secure: env.APP_URL.startsWith("https://"),
    });
  }

  try {
    const { reply } = await handleClientMessage({ businessId: business.id, phone, text: body.data.text, channel: "web" }, deps);
    const messages = await loadDisplayMessages(deps.conversations, business.id, phone, "web");
    return Response.json({ reply, messages });
  } catch (e) {
    if (!(e instanceof ChatError)) throw e;
    switch (e.code) {
      case "session_limit":
        return error(429, e.code, sessionLimitMessage(env.DEMO_MAX_MESSAGES_PER_SESSION));
      case "llm_unavailable":
        console.error("[chat] concierge turn failed", { business: business.slug, error: e.message });
        return error(503, e.code, LLM_UNAVAILABLE_MESSAGE);
      case "business_not_found":
        return error(404, e.code, "Este negocio no existe.");
      case "invalid_input":
        return error(400, e.code, "No pude leer tu mensaje. Escríbelo de nuevo, por favor.");
    }
  }
}
