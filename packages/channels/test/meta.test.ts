import { describe, expect, it, vi } from "vitest";
import { hmacSha256Hex } from "@whaitsapp/shared";
import { MetaCloudProvider } from "../src/meta.js";

const APP_SECRET = "test-app-secret";

function provider(fetchImpl?: typeof fetch) {
  return new MetaCloudProvider({
    appSecret: APP_SECRET,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

function signed(rawBody: string) {
  return {
    rawBody,
    headers: { "x-hub-signature-256": `sha256=${hmacSha256Hex(APP_SECRET, rawBody)}` },
  };
}

const sampleWebhook = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_ID",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550001111", phone_number_id: "PHONE_ID" },
            contacts: [{ profile: { name: "Ana" }, wa_id: "573001112233" }],
            messages: [
              {
                from: "573001112233",
                id: "wamid.abc123",
                timestamp: "1735000000",
                type: "text",
                text: { body: "Hola, ¿tienen la camiseta azul?" },
              },
            ],
          },
        },
      ],
    },
  ],
});

describe("MetaCloudProvider.verifyWebhookSignature", () => {
  it("accepts a valid signature", () => {
    expect(provider().verifyWebhookSignature(signed(sampleWebhook))).toBe(true);
  });

  it("rejects a tampered body", () => {
    const req = signed(sampleWebhook);
    req.rawBody = sampleWebhook.replace("azul", "roja");
    expect(provider().verifyWebhookSignature(req)).toBe(false);
  });

  it("rejects missing or malformed signature headers", () => {
    expect(provider().verifyWebhookSignature({ rawBody: sampleWebhook, headers: {} })).toBe(false);
    expect(
      provider().verifyWebhookSignature({ rawBody: sampleWebhook, headers: { "x-hub-signature-256": "md5=nope" } }),
    ).toBe(false);
  });
});

describe("MetaCloudProvider.verifySubscription", () => {
  it("echoes the challenge on a valid subscribe", () => {
    const challenge = provider().verifySubscription(
      { "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "12345" },
      "tok",
    );
    expect(challenge).toBe("12345");
  });

  it("rejects a wrong verify token", () => {
    expect(
      provider().verifySubscription({ "hub.mode": "subscribe", "hub.verify_token": "wrong" }, "tok"),
    ).toBeNull();
  });
});

describe("MetaCloudProvider.parseInboundWebhook", () => {
  it("parses a text message with contact name and routing metadata", () => {
    const events = provider().parseInboundWebhook({ rawBody: sampleWebhook, headers: {} });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "message",
      phoneNumberId: "PHONE_ID",
      providerMessageId: "wamid.abc123",
      from: "573001112233",
      contactName: "Ana",
      type: "text",
      text: "Hola, ¿tienen la camiseta azul?",
      timestamp: 1735000000000,
    });
  });

  it("parses status updates", () => {
    const statusWebhook = JSON.stringify({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "PHONE_ID" },
                statuses: [
                  { id: "wamid.out1", status: "delivered", recipient_id: "573001112233", timestamp: "1735000100" },
                ],
              },
            },
          ],
        },
      ],
    });
    const events = provider().parseInboundWebhook({ rawBody: statusWebhook, headers: {} });
    expect(events).toEqual([
      {
        kind: "status",
        phoneNumberId: "PHONE_ID",
        providerMessageId: "wamid.out1",
        status: "delivered",
        recipient: "573001112233",
        timestamp: 1735000100000,
      },
    ]);
  });
});

describe("MetaCloudProvider.sendText", () => {
  it("posts to the Graph API and returns the message ref", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.sent1" }] }), { status: 200 }),
    );
    const ref = await provider(fetchMock as unknown as typeof fetch).sendText(
      { accessToken: "token", phoneNumberId: "PHONE_ID" },
      "573001112233",
      "¡Tu pedido va en camino!",
    );
    expect(ref.providerMessageId).toBe("wamid.sent1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/PHONE_ID/messages");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer token" });
  });

  it("throws MetaApiError on API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "rate limited", type: "OAuthException", code: 130429 } }), {
        status: 429,
      }),
    );
    await expect(
      provider(fetchMock as unknown as typeof fetch).sendText(
        { accessToken: "token", phoneNumberId: "PHONE_ID" },
        "573001112233",
        "hola",
      ),
    ).rejects.toMatchObject({ name: "MetaApiError", code: 130429 });
  });
});
