import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/**
 * Multi-tenant shared schema. Every tenant-owned table carries tenant_id and is
 * protected by Row-Level Security (see migrations/0001_rls.sql). Application code
 * must always query through a tenant-scoped connection (see tenantTransaction).
 */

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("trial"),
  status: text("status").notNull().default("active"),
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email), index("users_tenant_idx").on(t.tenantId)],
);

export const channels = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("whatsapp_cloud"),
    wabaId: text("waba_id"),
    phoneNumberId: text("phone_number_id"),
    displayPhone: text("display_phone"),
    qualityRating: text("quality_rating"),
    messagingTier: text("messaging_tier"),
    /** AES-256-GCM encrypted provider credentials (access token etc.) — never plaintext. */
    credentialsEnc: text("credentials_enc"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("channels_tenant_idx").on(t.tenantId),
    uniqueIndex("channels_phone_number_id_idx").on(t.phoneNumberId),
  ],
);

export const shopifyStores = pgTable(
  "shopify_stores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    shopDomain: text("shop_domain").notNull(),
    /** AES-256-GCM encrypted Admin API access token. */
    accessTokenEnc: text("access_token_enc"),
    scopes: text("scopes"),
    status: text("status").notNull().default("installed"),
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
    uninstalledAt: timestamp("uninstalled_at", { withTimezone: true }),
  },
  (t) => [index("shopify_stores_tenant_idx").on(t.tenantId), uniqueIndex("shopify_stores_domain_idx").on(t.shopDomain)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    waPhone: text("wa_phone").notNull(),
    name: text("name"),
    optIn: boolean("opt_in").notNull().default(false),
    optInSource: text("opt_in_source"),
    optInAt: timestamp("opt_in_at", { withTimezone: true }),
    /** Drives the 24h customer-service-window check on every outbound send. */
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    shopifyCustomerId: text("shopify_customer_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("contacts_tenant_phone_idx").on(t.tenantId, t.waPhone)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").references(() => channels.id),
    status: text("status").notNull().default("bot"),
    assignedUserId: uuid("assigned_user_id").references(() => users.id),
    /** Running summary fed to the LLM alongside the sliding message window. */
    summary: text("summary"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_tenant_contact_idx").on(t.tenantId, t.contactId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    type: text("type").notNull().default("text"),
    body: text("body"),
    mediaUrl: text("media_url"),
    providerMsgId: text("provider_msg_id"),
    status: text("status").notNull().default("pending"),
    /** Auditability: who/what triggered this message (bot | campaign | human_agent | system). */
    trigger: text("trigger"),
    toolCalls: jsonb("tool_calls"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_tenant_conversation_idx").on(t.tenantId, t.conversationId, t.ts),
    uniqueIndex("messages_provider_msg_idx").on(t.tenantId, t.providerMsgId),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    shopifyProductId: text("shopify_product_id").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    handle: text("handle"),
    priceMin: numeric("price_min", { precision: 12, scale: 2 }),
    priceMax: numeric("price_max", { precision: 12, scale: 2 }),
    currency: text("currency"),
    inventoryQuantity: integer("inventory_quantity"),
    imageUrl: text("image_url"),
    status: text("status").notNull().default("active"),
    variants: jsonb("variants").notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("products_tenant_shopify_idx").on(t.tenantId, t.shopifyProductId)],
);

export const productEmbeddings = pgTable(
  "product_embeddings",
  {
    productId: uuid("product_id")
      .primaryKey()
      .references(() => products.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    embedding: vector("embedding", { dimensions: 1536 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("product_embeddings_tenant_idx").on(t.tenantId)],
);

export const kbDocuments = pgTable(
  "kb_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("kb_documents_tenant_idx").on(t.tenantId)],
);

export const carts = pgTable(
  "carts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id),
    checkoutToken: text("checkout_token").notNull(),
    abandonedCheckoutUrl: text("abandoned_checkout_url"),
    items: jsonb("items").notNull().default([]),
    value: numeric("value", { precision: 12, scale: 2 }),
    currency: text("currency"),
    status: text("status").notNull().default("open"),
    /** none | scheduled | sent | replied | recovered | expired */
    recoveryState: text("recovery_state").notNull().default("none"),
    recoveredOrderId: text("recovered_order_id"),
    recoveredValue: numeric("recovered_value", { precision: 12, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("carts_tenant_checkout_idx").on(t.tenantId, t.checkoutToken)],
);

export const ordersCache = pgTable(
  "orders_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    shopifyOrderId: text("shopify_order_id").notNull(),
    orderNumber: text("order_number"),
    contactId: uuid("contact_id").references(() => contacts.id),
    customerPhone: text("customer_phone"),
    status: text("status"),
    fulfillmentStatus: text("fulfillment_status"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    totalPrice: numeric("total_price", { precision: 12, scale: 2 }),
    currency: text("currency"),
    checkoutToken: text("checkout_token"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("orders_tenant_shopify_idx").on(t.tenantId, t.shopifyOrderId)],
);

export const messageTemplates = pgTable(
  "message_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    metaTemplateId: text("meta_template_id"),
    name: text("name").notNull(),
    language: text("language").notNull().default("es"),
    category: text("category").notNull(),
    /** draft | submitted | approved | rejected | paused */
    status: text("status").notNull().default("draft"),
    body: text("body").notNull(),
    components: jsonb("components").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("templates_tenant_name_lang_idx").on(t.tenantId, t.name, t.language)],
);

/**
 * Idempotency ledger for at-least-once webhook delivery (Meta + Shopify).
 * Insert inside the same transaction as the side effect; unique violation → duplicate → no-op.
 * Not tenant-scoped: events can arrive before tenant resolution.
 */
export const processedEvents = pgTable(
  "processed_events",
  {
    eventId: text("event_id").primaryKey(),
    source: text("source").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("processed_events_at_idx").on(t.processedAt)],
);

/** Metering for billing + plan limits (llm_tokens, wa_conversation, ai_message, ...). */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    qty: numeric("qty", { precision: 14, scale: 4 }).notNull(),
    cost: numeric("cost", { precision: 12, scale: 6 }),
    meta: jsonb("meta").notNull().default({}),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_tenant_kind_ts_idx").on(t.tenantId, t.kind, t.ts)],
);
