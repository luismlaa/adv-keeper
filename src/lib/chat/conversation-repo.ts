import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { StoredMessage, StoredRole } from "./history";

export type ChatChannel = "web" | "whatsapp";

export interface NewStoredMessage {
  businessId: string;
  conversationId: string;
  role: StoredRole;
  content: string;
  payload?: unknown;
}

/**
 * Conversation persistence port. Every method takes `businessId` and implementations MUST filter by
 * it, so a caller bug can never read or write another tenant's conversation.
 */
export interface ConversationRepo {
  /** Client id for (business, phone) without creating her — used for page loads and phone allocation. */
  findClientIdByPhone(businessId: string, phone: string): Promise<string | null>;
  /** Most recent conversation of this client on this channel, or null. */
  findConversation(businessId: string, clientId: string, channel: ChatChannel): Promise<string | null>;
  createConversation(businessId: string, clientId: string, channel: ChatChannel): Promise<string>;
  /** Last `limit` messages, oldest first. */
  listRecentMessages(businessId: string, conversationId: string, limit: number): Promise<StoredMessage[]>;
  countClientMessages(businessId: string, conversationId: string): Promise<number>;
  insertMessage(message: NewStoredMessage): Promise<StoredMessage>;
  touchConversation(businessId: string, conversationId: string, at: Date): Promise<void>;
}

export class ConversationRepoError extends Error {
  constructor(operation: string, cause: { message: string; code?: string }) {
    super(`${operation} failed: ${cause.message}${cause.code ? ` (${cause.code})` : ""}`);
    this.name = "ConversationRepoError";
  }
}

const messageRowSchema = z.object({
  id: z.string(),
  role: z.enum(["client", "assistant", "owner", "system"]),
  content: z.string(),
  payload: z.unknown(),
  created_at: z.string(),
});

function toStoredMessage(row: unknown): StoredMessage {
  const r = messageRowSchema.parse(row);
  return { id: r.id, role: r.role, content: r.content, payload: r.payload ?? {}, createdAt: r.created_at };
}

/** ConversationRepo over Supabase with the service-role (admin) client. */
export class SupabaseConversationRepo implements ConversationRepo {
  constructor(private readonly db: SupabaseClient) {}

  async findClientIdByPhone(businessId: string, phone: string): Promise<string | null> {
    const { data, error } = await this.db.from("clients").select("id").eq("business_id", businessId).eq("phone", phone).maybeSingle();
    if (error) throw new ConversationRepoError("findClientIdByPhone", error);
    return data ? String(data.id) : null;
  }

  async findConversation(businessId: string, clientId: string, channel: ChatChannel): Promise<string | null> {
    const { data, error } = await this.db
      .from("conversations")
      .select("id")
      .eq("business_id", businessId)
      .eq("client_id", clientId)
      .eq("channel", channel)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new ConversationRepoError("findConversation", error);
    return data ? String(data.id) : null;
  }

  async createConversation(businessId: string, clientId: string, channel: ChatChannel): Promise<string> {
    const { data, error } = await this.db
      .from("conversations")
      .insert({ business_id: businessId, client_id: clientId, channel })
      .select("id")
      .single();
    if (error) throw new ConversationRepoError("createConversation", error);
    return String(data.id);
  }

  async listRecentMessages(businessId: string, conversationId: string, limit: number): Promise<StoredMessage[]> {
    const { data, error } = await this.db
      .from("messages")
      .select("id, role, content, payload, created_at")
      .eq("business_id", businessId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) throw new ConversationRepoError("listRecentMessages", error);
    return data.map(toStoredMessage).reverse();
  }

  async countClientMessages(businessId: string, conversationId: string): Promise<number> {
    const { count, error } = await this.db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("conversation_id", conversationId)
      .eq("role", "client");
    if (error) throw new ConversationRepoError("countClientMessages", error);
    return count ?? 0;
  }

  async insertMessage(message: NewStoredMessage): Promise<StoredMessage> {
    const { data, error } = await this.db
      .from("messages")
      .insert({
        business_id: message.businessId,
        conversation_id: message.conversationId,
        role: message.role,
        content: message.content,
        payload: message.payload ?? {},
      })
      .select("id, role, content, payload, created_at")
      .single();
    if (error) throw new ConversationRepoError("insertMessage", error);
    return toStoredMessage(data);
  }

  async touchConversation(businessId: string, conversationId: string, at: Date): Promise<void> {
    const { error } = await this.db
      .from("conversations")
      .update({ last_message_at: at.toISOString() })
      .eq("business_id", businessId)
      .eq("id", conversationId);
    if (error) throw new ConversationRepoError("touchConversation", error);
  }
}
