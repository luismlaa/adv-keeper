import type { MessagingChannel } from "./types";

/**
 * Web chat has no push transport: the caller persists every message and the chat UI reads them back.
 * Sending therefore only assigns an id.
 */
export class WebChannel implements MessagingChannel {
  readonly kind = "web" as const;

  async sendText(): Promise<{ messageId: string }> {
    return { messageId: `web-${crypto.randomUUID()}` };
  }

  async sendTemplate(): Promise<{ messageId: string }> {
    return { messageId: `web-${crypto.randomUUID()}` };
  }
}
