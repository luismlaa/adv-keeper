import type { ChatChannel, ConversationRepo } from "./conversation-repo";
import { toDisplayMessages, type DisplayMessage } from "./history";

/** Bubbles shown in the chat UI (enough for a demo session; older ones stay in the DB). */
export const DISPLAY_WINDOW = 60;

/** Read-only: the client's current conversation as UI bubbles. Never creates clients or conversations. */
export async function loadDisplayMessages(
  conversations: ConversationRepo,
  businessId: string,
  phone: string,
  channel: ChatChannel,
): Promise<DisplayMessage[]> {
  const clientId = await conversations.findClientIdByPhone(businessId, phone);
  if (clientId === null) return [];
  const conversationId = await conversations.findConversation(businessId, clientId, channel);
  if (conversationId === null) return [];
  return toDisplayMessages(await conversations.listRecentMessages(businessId, conversationId, DISPLAY_WINDOW));
}
