/** Shopify webhook topics the platform subscribes to, and what each powers. */
export const SHOPIFY_WEBHOOK_TOPICS = {
  // Abandoned cart detection
  CHECKOUTS_CREATE: "checkouts/create",
  CHECKOUTS_UPDATE: "checkouts/update",
  // Order lifecycle notifications
  ORDERS_CREATE: "orders/create",
  ORDERS_UPDATED: "orders/updated",
  ORDERS_CANCELLED: "orders/cancelled",
  ORDERS_FULFILLED: "orders/fulfilled",
  FULFILLMENTS_UPDATE: "fulfillments/update",
  // Catalog freshness
  PRODUCTS_CREATE: "products/create",
  PRODUCTS_UPDATE: "products/update",
  PRODUCTS_DELETE: "products/delete",
  // Tenant offboarding
  APP_UNINSTALLED: "app/uninstalled",
  // Mandatory privacy webhooks for public apps
  CUSTOMERS_DATA_REQUEST: "customers/data_request",
  CUSTOMERS_REDACT: "customers/redact",
  SHOP_REDACT: "shop/redact",
} as const;

export type ShopifyWebhookTopic = (typeof SHOPIFY_WEBHOOK_TOPICS)[keyof typeof SHOPIFY_WEBHOOK_TOPICS];

export const ALL_SUBSCRIBED_TOPICS: ShopifyWebhookTopic[] = Object.values(SHOPIFY_WEBHOOK_TOPICS);

export interface ShopifyWebhookHeaders {
  topic: string | undefined;
  shopDomain: string | undefined;
  hmac: string | undefined;
  webhookId: string | undefined;
  apiVersion: string | undefined;
}

export function parseShopifyWebhookHeaders(
  headers: Record<string, string | string[] | undefined>,
): ShopifyWebhookHeaders {
  const get = (name: string): string | undefined => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    topic: get("x-shopify-topic"),
    shopDomain: get("x-shopify-shop-domain"),
    hmac: get("x-shopify-hmac-sha256"),
    webhookId: get("x-shopify-webhook-id"),
    apiVersion: get("x-shopify-api-version"),
  };
}
