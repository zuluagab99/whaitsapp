import { describe, expect, it, vi } from "vitest";
import { hmacSha256Base64, hmacSha256Hex } from "@whaitsapp/shared";
import { ShopifyClient, isValidShopDomain } from "../src/shopify.js";

const SECRET = "shopify-test-secret";

function client(fetchImpl?: typeof fetch) {
  return new ShopifyClient({
    apiKey: "key",
    apiSecret: SECRET,
    scopes: "read_products,read_orders",
    appUrl: "https://app.example.com",
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

describe("verifyWebhookHmac", () => {
  const body = JSON.stringify({ id: 123, email: "a@b.co" });

  it("accepts a valid base64 HMAC", () => {
    expect(client().verifyWebhookHmac(body, hmacSha256Base64(SECRET, body))).toBe(true);
  });

  it("rejects tampered bodies and missing headers", () => {
    expect(client().verifyWebhookHmac(body + " ", hmacSha256Base64(SECRET, body))).toBe(false);
    expect(client().verifyWebhookHmac(body, undefined)).toBe(false);
  });
});

describe("verifyOAuthQuery", () => {
  it("accepts a correctly signed query", () => {
    const params: Record<string, string> = {
      code: "abc",
      shop: "test-store.myshopify.com",
      state: "nonce1",
      timestamp: "1735000000",
    };
    const message = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");
    const query = { ...params, hmac: hmacSha256Hex(SECRET, message) };
    expect(client().verifyOAuthQuery(query)).toBe(true);
  });

  it("rejects a forged hmac", () => {
    expect(
      client().verifyOAuthQuery({ code: "abc", shop: "test.myshopify.com", hmac: "deadbeef" }),
    ).toBe(false);
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds the grant URL with scopes and state", () => {
    const url = client().buildAuthorizeUrl("test-store.myshopify.com", "nonce1");
    expect(url).toContain("https://test-store.myshopify.com/admin/oauth/authorize");
    expect(url).toContain("state=nonce1");
    expect(url).toContain("client_id=key");
  });

  it("rejects non-myshopify domains (SSRF guard)", () => {
    expect(() => client().buildAuthorizeUrl("evil.com", "s")).toThrow(/invalid shop domain/);
    expect(() => client().buildAuthorizeUrl("evil.com/x.myshopify.com", "s")).toThrow(/invalid shop domain/);
  });
});

describe("isValidShopDomain", () => {
  it("validates domains", () => {
    expect(isValidShopDomain("my-store.myshopify.com")).toBe(true);
    expect(isValidShopDomain("MY-STORE.myshopify.com")).toBe(false);
    expect(isValidShopDomain("myshopify.com")).toBe(false);
    expect(isValidShopDomain("a.myshopify.com.evil.com")).toBe(false);
  });
});

describe("graphql", () => {
  it("sends the query with the access token and returns data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { shop: { name: "Test" } } }), { status: 200 }),
    );
    const data = await client(fetchMock as unknown as typeof fetch).graphql<{ shop: { name: string } }>(
      "test.myshopify.com",
      "shpat_token",
      "{ shop { name } }",
    );
    expect(data.shop.name).toBe("Test");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/admin/api/");
    expect((init as RequestInit).headers).toMatchObject({ "X-Shopify-Access-Token": "shpat_token" });
  });

  it("throws on GraphQL errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: "Access denied" }] }), { status: 200 }),
    );
    await expect(
      client(fetchMock as unknown as typeof fetch).graphql("test.myshopify.com", "t", "{ shop { name } }"),
    ).rejects.toThrow(/Access denied/);
  });
});
