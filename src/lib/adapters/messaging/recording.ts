import type { MessagingChannel, OutboundTemplate, OutboundText } from "./types";

export type RecordedMessage = ({ type: "text" } & OutboundText) | ({ type: "template" } & OutboundTemplate);

/** Captures outbound messages — used by tests and by crons in demo mode to show what would be sent. */
export class RecordingChannel implements MessagingChannel {
  readonly kind = "recording" as const;
  private log: readonly RecordedMessage[] = [];

  get sent(): readonly RecordedMessage[] {
    return this.log;
  }

  async sendText(message: OutboundText): Promise<{ messageId: string }> {
    this.log = [...this.log, { type: "text", ...message }];
    return { messageId: `rec-${this.log.length}` };
  }

  async sendTemplate(message: OutboundTemplate): Promise<{ messageId: string }> {
    this.log = [...this.log, { type: "template", ...message }];
    return { messageId: `rec-${this.log.length}` };
  }
}
