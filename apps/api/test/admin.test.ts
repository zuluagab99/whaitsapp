import { describe, expect, it, vi } from "vitest";
import { MetaCloudProvider } from "@whaitsapp/channels";
import { ShopifyClient } from "@whaitsapp/commerce";
import type { Workflow } from "@whaitsapp/workflows";
import { buildApp, type AppDeps } from "../src/app.js";
import type { AdminStore } from "../src/admin.js";

const TOKEN = "test-admin-token-1234";
const TENANT = "11111111-1111-4111-8111-111111111111";
const WF_ID = "22222222-2222-4222-8222-222222222222";

function makeApp(store: Partial<AdminStore> = {}) {
  const fullStore: AdminStore = {
    getLlmSettings: vi.fn(async () => ({})),
    putLlmSettings: vi.fn(async () => undefined),
    listWorkflows: vi.fn(async () => []),
    createWorkflow: vi.fn(async (_t, def) => ({ id: WF_ID, ...def }) as Workflow),
    updateWorkflow: vi.fn(async () => null),
    deleteWorkflow: vi.fn(async () => false),
    ...store,
  };
  const deps: AppDeps = {
    meta: new MetaCloudProvider({ appSecret: "s" }),
    metaVerifyToken: "v",
    shopify: new ShopifyClient({ apiKey: "k", apiSecret: "s", scopes: "read_products", appUrl: "https://x" }),
    queues: { inboundMessages: { add: vi.fn() } as never, shopifyEvents: { add: vi.fn() } as never },
    resolveChannel: vi.fn(async () => null),
    resolveShop: vi.fn(async () => null),
    admin: { token: TOKEN, store: fullStore },
  };
  return { app: buildApp(deps), store: fullStore };
}

const auth = { authorization: `Bearer ${TOKEN}` };

describe("admin auth", () => {
  it("rejects missing or wrong bearer token", async () => {
    const { app } = makeApp();
    expect((await app.inject({ method: "GET", url: `/admin/tenants/${TENANT}/llm` })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: `/admin/tenants/${TENANT}/llm`, headers: { authorization: "Bearer nope" } }))
        .statusCode,
    ).toBe(401);
  });

  it("leaves non-admin routes unauthenticated", async () => {
    const { app } = makeApp();
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });
});

describe("llm settings", () => {
  it("accepts a catalog model and persists it", async () => {
    const { app, store } = makeApp();
    const res = await app.inject({
      method: "PUT",
      url: `/admin/tenants/${TENANT}/llm`,
      headers: auth,
      payload: { conversation: { provider: "openai", model: "gpt-5" } },
    });
    expect(res.statusCode).toBe(200);
    expect(store.putLlmSettings).toHaveBeenCalledWith(TENANT, {
      conversation: { provider: "openai", model: "gpt-5" },
    });
  });

  it("rejects a model outside the catalog", async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: "PUT",
      url: `/admin/tenants/${TENANT}/llm`,
      headers: auth,
      payload: { conversation: { provider: "anthropic", model: "made-up-model" } },
    });
    expect(res.statusCode).toBe(422);
  });

  it("returns settings alongside the model catalog", async () => {
    const { app } = makeApp({
      getLlmSettings: vi.fn(async () => ({ conversation: { provider: "anthropic" as const, model: "claude-sonnet-5" } })),
    });
    const res = await app.inject({ method: "GET", url: `/admin/tenants/${TENANT}/llm`, headers: auth });
    const body = res.json();
    expect(body.settings.conversation.model).toBe("claude-sonnet-5");
    expect(body.models.length).toBeGreaterThan(0);
  });
});

describe("workflows crud", () => {
  const definition = {
    name: "FAQ envío",
    trigger: { type: "message_received", keywords: ["envío"] },
    actions: [{ type: "send_message", text: "Enviamos en 24h a toda Colombia" }],
  };

  it("creates a valid workflow", async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/admin/tenants/${TENANT}/workflows`,
      headers: auth,
      payload: definition,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().workflow.id).toBe(WF_ID);
  });

  it("rejects an invalid workflow definition", async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/admin/tenants/${TENANT}/workflows`,
      headers: auth,
      payload: { name: "bad", trigger: { type: "nope" }, actions: [] },
    });
    expect(res.statusCode).toBe(422);
  });

  it("404s on update/delete of a missing workflow", async () => {
    const { app } = makeApp();
    expect(
      (await app.inject({ method: "PUT", url: `/admin/tenants/${TENANT}/workflows/${WF_ID}`, headers: auth, payload: definition }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "DELETE", url: `/admin/tenants/${TENANT}/workflows/${WF_ID}`, headers: auth })).statusCode,
    ).toBe(404);
  });
});
