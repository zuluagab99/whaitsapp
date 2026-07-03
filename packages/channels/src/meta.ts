import { hmacSha256Hex, safeCompare } from "@whaitsapp/shared";
import type {
  ChannelCredentials,
  ChannelProvider,
  InboundEvent,
  MediaPayload,
  MessageRef,
  RawWebhook,
  TemplateRef,
} from "./provider.js";

export interface MetaCloudOptions {
  appSecret: string;
  graphApiVersion?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

interface MetaSendResponse {
  messages?: Array<{ id: string }>;
  error?: { message: string; type: string; code: number };
}

/** WhatsApp Cloud API implementation of the ChannelProvider gateway. */
export class MetaCloudProvider implements ChannelProvider {
  readonly name = "meta-cloud";
  private readonly appSecret: string;
  private readonly version: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(opts: MetaCloudOptions) {
    this.appSecret = opts.appSecret;
    this.version = opts.graphApiVersion ?? "v21.0";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? "https://graph.facebook.com";
  }

  async sendText(creds: ChannelCredentials, to: string, body: string): Promise<MessageRef> {
    return this.send(creds, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body, preview_url: true },
    });
  }

  async sendTemplate(creds: ChannelCredentials, to: string, tpl: TemplateRef): Promise<MessageRef> {
    return this.send(creds, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: tpl.name,
        language: { code: tpl.language },
        components: tpl.components ?? [],
      },
    });
  }

  async sendMedia(creds: ChannelCredentials, to: string, media: MediaPayload): Promise<MessageRef> {
    const mediaObject: Record<string, unknown> = media.mediaId ? { id: media.mediaId } : { link: media.url };
    if (media.caption) mediaObject.caption = media.caption;
    if (media.filename && media.kind === "document") mediaObject.filename = media.filename;
    return this.send(creds, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: media.kind,
      [media.kind]: mediaObject,
    });
  }

  /**
   * Verify X-Hub-Signature-256 against the raw body. Reject-early rule:
   * webhooks failing this check must never reach the queue.
   */
  verifyWebhookSignature(req: RawWebhook): boolean {
    const header = req.headers["x-hub-signature-256"];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!signature?.startsWith("sha256=")) return false;
    const expected = `sha256=${hmacSha256Hex(this.appSecret, req.rawBody)}`;
    return safeCompare(signature, expected);
  }

  /** Handle the GET subscription handshake. Returns the challenge to echo, or null to reject. */
  verifySubscription(query: Record<string, string | undefined>, verifyToken: string): string | null {
    if (query["hub.mode"] === "subscribe" && query["hub.verify_token"] === verifyToken) {
      return query["hub.challenge"] ?? null;
    }
    return null;
  }

  parseInboundWebhook(req: RawWebhook): InboundEvent[] {
    const payload = JSON.parse(
      typeof req.rawBody === "string" ? req.rawBody : req.rawBody.toString("utf8"),
    ) as MetaWebhookPayload;
    const events: InboundEvent[] = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id ?? "";
        const nameByWaId = new Map(
          (value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name] as const),
        );
        for (const msg of value?.messages ?? []) {
          const contactName = nameByWaId.get(msg.from);
          const text = msg.text?.body ?? (msg.interactive ? extractInteractiveText(msg.interactive) : undefined);
          const mediaId = extractMediaId(msg);
          events.push({
            kind: "message",
            phoneNumberId,
            providerMessageId: msg.id,
            from: msg.from,
            ...(contactName !== undefined ? { contactName } : {}),
            type: normalizeType(msg.type),
            ...(text !== undefined ? { text } : {}),
            ...(mediaId !== undefined ? { mediaId } : {}),
            timestamp: Number(msg.timestamp) * 1000,
          });
        }
        for (const status of value?.statuses ?? []) {
          events.push({
            kind: "status",
            phoneNumberId,
            providerMessageId: status.id,
            status: normalizeStatus(status.status),
            recipient: status.recipient_id,
            timestamp: Number(status.timestamp) * 1000,
            ...(status.errors?.[0]?.title ? { error: status.errors[0].title } : {}),
          });
        }
      }
    }
    return events;
  }

  private async send(creds: ChannelCredentials, body: Record<string, unknown>): Promise<MessageRef> {
    const res = await this.fetchImpl(`${this.baseUrl}/${this.version}/${creds.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as MetaSendResponse;
    if (!res.ok || data.error) {
      throw new MetaApiError(data.error?.message ?? `HTTP ${res.status}`, data.error?.code ?? res.status);
    }
    const id = data.messages?.[0]?.id;
    if (!id) throw new MetaApiError("Meta response missing message id", res.status);
    return { providerMessageId: id };
  }
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

function normalizeType(type: string): "text" | "image" | "audio" | "video" | "document" | "interactive" | "unsupported" {
  switch (type) {
    case "text":
    case "image":
    case "audio":
    case "video":
    case "document":
    case "interactive":
      return type;
    default:
      return "unsupported";
  }
}

function normalizeStatus(status: string): "sent" | "delivered" | "read" | "failed" {
  switch (status) {
    case "sent":
    case "delivered":
    case "read":
      return status;
    default:
      return "failed";
  }
}

function extractMediaId(msg: MetaMessage): string | undefined {
  return msg.image?.id ?? msg.audio?.id ?? msg.video?.id ?? msg.document?.id;
}

function extractInteractiveText(interactive: NonNullable<MetaMessage["interactive"]>): string | undefined {
  return interactive.button_reply?.title ?? interactive.list_reply?.title;
}

interface MetaMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string };
  audio?: { id: string };
  video?: { id: string };
  document?: { id: string };
  interactive?: {
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
}

interface MetaWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      field: string;
      value?: {
        metadata?: { phone_number_id: string };
        contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
        messages?: MetaMessage[];
        statuses?: Array<{
          id: string;
          status: string;
          recipient_id: string;
          timestamp: string;
          errors?: Array<{ title?: string }>;
        }>;
      };
    }>;
  }>;
}
