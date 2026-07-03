/** Branded tenant identifier — every cross-module call that touches data carries one. */
export type TenantId = string & { readonly __brand: "TenantId" };

export function tenantId(id: string): TenantId {
  return id as TenantId;
}

export type MessageDirection = "inbound" | "outbound";

export type MessageType = "text" | "image" | "audio" | "video" | "document" | "template" | "interactive";

export type ConversationStatus = "bot" | "human" | "closed";

export type OutboundTrigger = "bot" | "campaign" | "human_agent" | "system";

/** Queue names shared between the API (producers) and the worker (consumers). */
export const QUEUES = {
  inboundMessages: "inbound-messages",
  outboundMessages: "outbound-messages",
  shopifyEvents: "shopify-events",
  cartRecovery: "cart-recovery",
  catalogSync: "catalog-sync",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface InboundMessageJob {
  tenantId: string;
  channelId: string;
  providerMessageId: string;
  from: string;
  type: MessageType;
  body?: string;
  mediaId?: string;
  timestamp: number;
}

export interface OutboundMessageJob {
  tenantId: string;
  channelId: string;
  to: string;
  trigger: OutboundTrigger;
  conversationId?: string;
  text?: string;
  template?: {
    name: string;
    language: string;
    components?: unknown[];
  };
}

export interface ShopifyEventJob {
  tenantId: string;
  shopDomain: string;
  topic: string;
  eventId: string;
  payload: unknown;
}

export interface CartRecoveryJob {
  tenantId: string;
  cartId: string;
  checkoutToken: string;
  attempt: number;
}
