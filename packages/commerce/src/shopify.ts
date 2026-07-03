import { hmacSha256Base64, hmacSha256Hex, safeCompare } from "@whaitsapp/shared";

export interface ShopifyAppConfig {
  apiKey: string;
  apiSecret: string;
  scopes: string;
  appUrl: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_API_VERSION = "2025-01";

/** Shopify public-app client: OAuth, webhook HMAC verification, GraphQL Admin API. */
export class ShopifyClient {
  private readonly cfg: Required<Pick<ShopifyAppConfig, "apiKey" | "apiSecret" | "scopes" | "appUrl">> & {
    apiVersion: string;
    fetchImpl: typeof fetch;
  };

  constructor(cfg: ShopifyAppConfig) {
    this.cfg = {
      apiKey: cfg.apiKey,
      apiSecret: cfg.apiSecret,
      scopes: cfg.scopes,
      appUrl: cfg.appUrl,
      apiVersion: cfg.apiVersion ?? DEFAULT_API_VERSION,
      fetchImpl: cfg.fetchImpl ?? fetch,
    };
  }

  /** Step 1 of the OAuth grant: redirect the merchant here. */
  buildAuthorizeUrl(shopDomain: string, state: string): string {
    assertValidShopDomain(shopDomain);
    const params = new URLSearchParams({
      client_id: this.cfg.apiKey,
      scope: this.cfg.scopes,
      redirect_uri: `${this.cfg.appUrl}/shopify/callback`,
      state,
    });
    return `https://${shopDomain}/admin/oauth/authorize?${params}`;
  }

  /**
   * Verify the HMAC on OAuth callback / app-load query strings.
   * Shopify signs the query (minus `hmac`) with the app secret, hex-encoded.
   */
  verifyOAuthQuery(query: Record<string, string | undefined>): boolean {
    const { hmac, ...rest } = query;
    if (!hmac) return false;
    const message = Object.keys(rest)
      .sort()
      .filter((k) => rest[k] !== undefined)
      .map((k) => `${k}=${rest[k]}`)
      .join("&");
    return safeCompare(hmac, hmacSha256Hex(this.cfg.apiSecret, message));
  }

  /** Verify X-Shopify-Hmac-Sha256 on webhooks: base64 HMAC of the raw body. */
  verifyWebhookHmac(rawBody: Buffer | string, hmacHeader: string | undefined): boolean {
    if (!hmacHeader) return false;
    return safeCompare(hmacHeader, hmacSha256Base64(this.cfg.apiSecret, rawBody));
  }

  /** Step 2: exchange the authorization code for a permanent access token. */
  async exchangeCodeForToken(shopDomain: string, code: string): Promise<{ accessToken: string; scope: string }> {
    assertValidShopDomain(shopDomain);
    const res = await this.cfg.fetchImpl(`https://${shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.cfg.apiKey,
        client_secret: this.cfg.apiSecret,
        code,
      }),
    });
    if (!res.ok) throw new ShopifyApiError(`token exchange failed: HTTP ${res.status}`, res.status);
    const data = (await res.json()) as { access_token: string; scope: string };
    return { accessToken: data.access_token, scope: data.scope };
  }

  /** GraphQL Admin API request (REST Admin API is legacy for new apps). */
  async graphql<T>(
    shopDomain: string,
    accessToken: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    assertValidShopDomain(shopDomain);
    const res = await this.cfg.fetchImpl(
      `https://${shopDomain}/admin/api/${this.cfg.apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query, variables: variables ?? {} }),
      },
    );
    if (!res.ok) throw new ShopifyApiError(`GraphQL request failed: HTTP ${res.status}`, res.status);
    const payload = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (payload.errors?.length) {
      throw new ShopifyApiError(payload.errors.map((e) => e.message).join("; "), 200);
    }
    if (payload.data === undefined) throw new ShopifyApiError("GraphQL response missing data", 200);
    return payload.data;
  }

  /** Register a webhook subscription pointing back at our API. */
  async registerWebhook(
    shopDomain: string,
    accessToken: string,
    topic: string,
    callbackPath: string,
  ): Promise<string> {
    const data = await this.graphql<{
      webhookSubscriptionCreate: {
        webhookSubscription: { id: string } | null;
        userErrors: Array<{ message: string }>;
      };
    }>(
      shopDomain,
      accessToken,
      `mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription { id }
          userErrors { message }
        }
      }`,
      {
        topic,
        webhookSubscription: { callbackUrl: `${this.cfg.appUrl}${callbackPath}`, format: "JSON" },
      },
    );
    const result = data.webhookSubscriptionCreate;
    if (!result.webhookSubscription) {
      throw new ShopifyApiError(
        `webhook registration failed: ${result.userErrors.map((e) => e.message).join("; ")}`,
        200,
      );
    }
    return result.webhookSubscription.id;
  }
}

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

export function isValidShopDomain(domain: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain);
}

function assertValidShopDomain(domain: string): void {
  if (!isValidShopDomain(domain)) {
    throw new ShopifyApiError(`invalid shop domain: ${domain}`, 400);
  }
}
