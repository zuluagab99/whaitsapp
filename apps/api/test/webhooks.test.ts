import { describe, expect, it, vi, beforeEach } from "vitest";
import { hmacSha256Base64, hmacSha256Hex } from "@whaitsapp/shared";
import { MetaCloudProvider } from "@whaitsapp/channels";
import { ShopifyClient } from "@whaitsapp/commerce";
import { buildApp, type AppDeps } from "../src/app.js";

const META_SECRET = "meta-secret";
const SHOPIFY_SECRET = "shopify-secret";
const VERIFY_TOKEN = "verify-token";

function makeDeps() {
  const inboundAdd = vi.fn();
  const shopifyAdd = vi.fn();
  const deps: AppDeps = {
    meta: new MetaCloudProvider({ appSecret: META_SECRET }),
    metaVerifyToken: VERIFY_TOKEN,
    shopify: new ShopifyClient({
      apiKey: "k",
      apiSecret: SHOPIFY_SECRET,
      scopes: "read_products",
      appUrl: "https://app.example.com",
    }),
    queues: {
      inboundMessages: { add: inboundAdd } as never,
      shopifyEvents: { add: shopifyAdd } as never,
    },
    resolveChannel: vi.fn(async (phoneNumberId: string) =>
      phoneNumberId === "PHONE_ID" ? { tenantId: "t1", channelId: "c1" } : null,
    ),
    resolveShop: vi.fn(async (domain: string) =>
      domain === "known.myshopify.com" ? { tenantId: "t1" } : null,
    ),
  };
  return { deps, inboundAdd, shopifyAdd };
}

const metaBody = JSON.stringify({
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "PHONE_ID" },
            contacts: [{ wa_id: "573001112233", profile: { name: "Ana" } }],
            messages: [
              { from: "573001112233", id: "wamid.x1", timestamp: "1735000000", type: "text", text: { body: "hola" } },
            ],
          },
        },
      ],
    },
  ],
});

describe("GET /webhooks/meta (subscription handshake)", () => {
  it("echoes the challenge for a valid token", async () => {
    const { deps } = makeDeps();
    const app = buildApp(deps);
    const res = await app.inject({
      method: "GET",
      url: "/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=42",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("42");
  });

  it("rejects a bad token", async () => {
    const { deps } = makeDeps();
    const app = buildApp(deps);
    const res = await app.inject({
      method: "GET",
      url: "/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42",
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /webhooks/meta", () => {
  let ctx: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    ctx = makeDeps();
  });

  it("verifies signature, resolves tenant, enqueues with dedupe id, acks 200", async () => {
    const app = buildApp(ctx.deps);
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/meta",
      payload: metaBody,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${hmacSha256Hex(META_SECRET, metaBody)}`,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.inboundAdd).toHaveBeenCalledTimes(1);
    const [, job, opts] = ctx.inboundAdd.mock.calls[0]!;
    expect(job).toMatchObject({ tenantId: "t1", channelId: "c1", from: "573001112233", body: "hola" });
    expect(opts).toMatchObject({ jobId: "meta:wamid.x1" });
  });

  it("rejects an invalid signature with 401 and enqueues nothing", async () => {
    const app = buildApp(ctx.deps);
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/meta",
      payload: metaBody,
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" },
    });
    expect(res.statusCode).toBe(401);
    expect(ctx.inboundAdd).not.toHaveBeenCalled();
  });

  it("skips events for unknown phone numbers but still acks", async () => {
    const body = metaBody.replace("PHONE_ID", "UNKNOWN");
    const app = buildApp(ctx.deps);
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/meta",
      payload: body,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${hmacSha256Hex(META_SECRET, body)}`,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.inboundAdd).not.toHaveBeenCalled();
  });
});

describe("POST /webhooks/shopify", () => {
  const payload = JSON.stringify({ id: 999, token: "tok_1" });

  it("verifies HMAC, enqueues with the webhook id, acks 200", async () => {
    const ctx = makeDeps();
    const app = buildApp(ctx.deps);
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/shopify",
      payload,
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "checkouts/update",
        "x-shopify-shop-domain": "known.myshopify.com",
        "x-shopify-webhook-id": "wh-123",
        "x-shopify-hmac-sha256": hmacSha256Base64(SHOPIFY_SECRET, payload),
      },
    });
    expect(res.statusCode).toBe(200);
    const [, job, opts] = ctx.shopifyAdd.mock.calls[0]!;
    expect(job).toMatchObject({ tenantId: "t1", topic: "checkouts/update", eventId: "wh-123" });
    expect(opts).toMatchObject({ jobId: "shopify:wh-123" });
  });

  it("rejects a bad HMAC with 401", async () => {
    const ctx = makeDeps();
    const app = buildApp(ctx.deps);
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/shopify",
      payload,
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "orders/create",
        "x-shopify-shop-domain": "known.myshopify.com",
        "x-shopify-webhook-id": "wh-124",
        "x-shopify-hmac-sha256": "forged",
      },
    });
    expect(res.statusCode).toBe(401);
    expect(ctx.shopifyAdd).not.toHaveBeenCalled();
  });

  it("acks unknown shops without enqueuing (stops Shopify retries)", async () => {
    const ctx = makeDeps();
    const app = buildApp(ctx.deps);
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/shopify",
      payload,
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "orders/create",
        "x-shopify-shop-domain": "gone.myshopify.com",
        "x-shopify-webhook-id": "wh-125",
        "x-shopify-hmac-sha256": hmacSha256Base64(SHOPIFY_SECRET, payload),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.shopifyAdd).not.toHaveBeenCalled();
  });
});
