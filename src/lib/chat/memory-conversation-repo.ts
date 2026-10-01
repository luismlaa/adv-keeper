import { randomUUID } from "node:crypto";
import type { StoredMessage } from "./history";
import type { ChatChannel, ConversationRepo, NewStoredMessage } from "./conversation-repo";

interface MemoryConversation {
  id: string;
  businessId: string;
  clientId: string;
  channel: ChatChannel;
  lastMessageAt: string;
}

interface MemoryMessageRow extends StoredMessage {
  businessId: string;
  conversationId: string;
}

/** In-memory ConversationRepo for tests; mirrors the Supabase implementation's tenant filtering. */
export class MemoryConversationRepo implements ConversationRepo {
  conversations: readonly MemoryConversation[] = [];
  messages: readonly MemoryMessageRow[] = [];

  constructor(
    private readonly clientPhones: (businessId: string, phone: string) => string | null = () => null,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async findClientIdByPhone(businessId: string, phone: string): Promise<string | null> {
    return this.clientPhones(businessId, phone);
  }

  async findConversation(businessId: string, clientId: string, channel: ChatChannel): Promise<string | null> {
    const matches = this.conversations
      .filter((c) => c.businessId === businessId && c.clientId === clientId && c.channel === channel)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    return matches[0]?.id ?? null;
  }

  async createConversation(businessId: string, clientId: string, channel: ChatChannel): Promise<string> {
    const conversation = { id: randomUUID(), businessId, clientId, channel, lastMessageAt: this.clock().toISOString() };
    this.conversations = [...this.conversations, conversation];
    return conversation.id;
  }

  async listRecentMessages(businessId: string, conversationId: string, limit: number): Promise<StoredMessage[]> {
    return this.messages
      .filter((m) => m.businessId === businessId && m.conversationId === conversationId)
      .slice(-limit)
      .map(({ id, role, content, payload, createdAt }) => ({ id, role, content, payload: structuredClone(payload), createdAt }));
  }

  async countClientMessages(businessId: string, conversationId: string): Promise<number> {
    return this.messages.filter((m) => m.businessId === businessId && m.conversationId === conversationId && m.role === "client").length;
  }

  async insertMessage(message: NewStoredMessage): Promise<StoredMessage> {
    const row: MemoryMessageRow = {
      id: randomUUID(),
      businessId: message.businessId,
      conversationId: message.conversationId,
      role: message.role,
      content: message.content,
      payload: structuredClone(message.payload ?? {}),
      createdAt: this.clock().toISOString(),
    };
    this.messages = [...this.messages, row];
    return { id: row.id, role: row.role, content: row.content, payload: structuredClone(row.payload), createdAt: row.createdAt };
  }

  async touchConversation(businessId: string, conversationId: string, at: Date): Promise<void> {
    this.conversations = this.conversations.map((c) =>
      c.businessId === businessId && c.id === conversationId ? { ...c, lastMessageAt: at.toISOString() } : c,
    );
  }
}
