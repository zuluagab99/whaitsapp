/**
 * Provider-agnostic messaging gateway. The whole platform talks to WhatsApp
 * exclusively through this interface so Meta Cloud API, 360dialog, or any
 * other BSP can be swapped without touching business logic.
 */

export interface MessageRef {
  providerMessageId: string;
}

export interface TemplateRef {
  name: string;
  language: string;
  components?: unknown[];
}

export interface MediaPayload {
  kind: "image" | "audio" | "video" | "document";
  /** Either a provider media id or a publicly reachable URL. */
  url?: string;
  mediaId?: string;
  caption?: string;
  filename?: string;
}

export interface RawWebhook {
  /** Raw request body bytes, exactly as received — required for signature verification. */
  rawBody: Buffer | string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | undefined>;
}

export interface InboundMessageEvent {
  kind: "message";
  /** Provider identifier for the receiving business number (routes to a tenant channel). */
  phoneNumberId: string;
  providerMessageId: string;
  from: string;
  contactName?: string;
  type: "text" | "image" | "audio" | "video" | "document" | "interactive" | "unsupported";
  text?: string;
  mediaId?: string;
  timestamp: number;
}

export interface MessageStatusEvent {
  kind: "status";
  phoneNumberId: string;
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  recipient: string;
  timestamp: number;
  error?: string;
}

export type InboundEvent = InboundMessageEvent | MessageStatusEvent;

/** Per-channel credentials, decrypted just-in-time from channels.credentials_enc. */
export interface ChannelCredentials {
  accessToken: string;
  phoneNumberId: string;
}

export interface ChannelProvider {
  readonly name: string;
  sendText(creds: ChannelCredentials, to: string, body: string): Promise<MessageRef>;
  sendTemplate(creds: ChannelCredentials, to: string, tpl: TemplateRef): Promise<MessageRef>;
  sendMedia(creds: ChannelCredentials, to: string, media: MediaPayload): Promise<MessageRef>;
  parseInboundWebhook(req: RawWebhook): InboundEvent[];
  verifyWebhookSignature(req: RawWebhook): boolean;
}
