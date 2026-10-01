import Anthropic from "@anthropic-ai/sdk";
import { resolveAdapters } from "@/lib/adapters/registry";
import { anthropicLlm } from "@/lib/agent/concierge";
import { getServerEnv } from "@/lib/config/env";
import { createAdminClient } from "@/lib/db/admin";
import { SupabaseStore } from "@/lib/store/supabase";
import { SupabaseConversationRepo } from "./conversation-repo";
import type { ChatDeps } from "./handle-message";

let cached: ChatDeps | undefined;

/** Production wiring: admin Supabase client, SupabaseStore, real Claude, adapters per business mode. */
export function defaultChatDeps(): ChatDeps {
  if (cached !== undefined) return cached;
  const env = getServerEnv();
  const db = createAdminClient(env);
  cached = {
    store: new SupabaseStore(db),
    conversations: new SupabaseConversationRepo(db),
    llm: anthropicLlm(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })),
    adapters: (business) => resolveAdapters(business, env),
    clock: () => new Date(),
    model: env.ANTHROPIC_MODEL,
    maxTokens: env.ANTHROPIC_MAX_TOKENS,
    demoMaxMessagesPerSession: env.DEMO_MAX_MESSAGES_PER_SESSION,
  };
  return cached;
}
