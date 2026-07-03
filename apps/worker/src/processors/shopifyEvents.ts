import { claimEvent, tenantTransaction, sql } from "@whaitsapp/db";
import {
  SHOPIFY_WEBHOOK_TOPICS,
  attributeRecovery,
  shouldScheduleRecovery,
  type CheckoutSnapshot,
} from "@whaitsapp/commerce";
import { QUEUES, type CartRecoveryJob, type ShopifyEventJob } from "@whaitsapp/shared";
import type { WorkerContext } from "../context.js";

/** Dispatch Shopify webhook events by topic, idempotently. */
export async function processShopifyEvent(ctx: WorkerContext, job: ShopifyEventJob): Promise<void> {
  await tenantTransaction(ctx.db, job.tenantId, async (tx) => {
    const fresh = await claimEvent(tx, `shopify:${job.eventId}`, "shopify");
    if (!fresh) return;

    switch (job.topic) {
      case SHOPIFY_WEBHOOK_TOPICS.CHECKOUTS_CREATE:
      case SHOPIFY_WEBHOOK_TOPICS.CHECKOUTS_UPDATE: {
        const checkout = parseCheckout(job.payload);
        if (!checkout) return;

        const existing = await tx.execute(
          sql`SELECT id, recovery_state FROM carts WHERE checkout_token = ${checkout.checkoutToken}`,
        );
        const alreadyScheduled =
          existing.rows.length > 0 &&
          (existing.rows[0] as { recovery_state: string }).recovery_state !== "none";

        await tx.execute(
          sql`INSERT INTO carts (tenant_id, checkout_token, abandoned_checkout_url, items, value, currency, status)
              VALUES (${job.tenantId}, ${checkout.checkoutToken}, ${checkout.abandonedCheckoutUrl},
                      ${JSON.stringify(checkout.lineItems)}::jsonb, ${checkout.totalPrice}, ${checkout.currency},
                      ${checkout.completedAt ? "completed" : "open"})
              ON CONFLICT (tenant_id, checkout_token)
              DO UPDATE SET items = EXCLUDED.items, value = EXCLUDED.value,
                            status = EXCLUDED.status, updated_at = now()`,
        );

        const decision = shouldScheduleRecovery(checkout, { alreadyScheduled });
        if (decision.schedule) {
          await tx.execute(
            sql`UPDATE carts SET recovery_state = 'scheduled' WHERE checkout_token = ${checkout.checkoutToken}`,
          );
          const cartRows = await tx.execute(
            sql`SELECT id FROM carts WHERE checkout_token = ${checkout.checkoutToken}`,
          );
          const recovery: CartRecoveryJob = {
            tenantId: job.tenantId,
            cartId: (cartRows.rows[0] as { id: string }).id,
            checkoutToken: checkout.checkoutToken,
            attempt: 1,
          };
          await ctx.enqueue(QUEUES.cartRecovery, "recover", recovery, {
            delay: decision.delayMs,
            jobId: `recover:${job.tenantId}:${checkout.checkoutToken}`,
          });
        }
        return;
      }

      case SHOPIFY_WEBHOOK_TOPICS.ORDERS_CREATE: {
        const order = parseOrder(job.payload);
        if (!order) return;
        await tx.execute(
          sql`INSERT INTO orders_cache (tenant_id, shopify_order_id, order_number, customer_phone, status, total_price, currency, checkout_token)
              VALUES (${job.tenantId}, ${order.id}, ${order.orderNumber}, ${order.phone}, ${order.status},
                      ${order.totalPrice}, ${order.currency}, ${order.checkoutToken})
              ON CONFLICT (tenant_id, shopify_order_id)
              DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
        );

        // Recovered-revenue attribution: the headline metric.
        if (order.checkoutToken) {
          const carts = await tx.execute(
            sql`SELECT checkout_token, recovery_state FROM carts WHERE checkout_token = ${order.checkoutToken}`,
          );
          const cart = carts.rows[0] as { checkout_token: string; recovery_state: string } | undefined;
          if (cart) {
            const attribution = attributeRecovery(
              { checkoutToken: order.checkoutToken, totalPrice: order.totalPrice },
              { checkoutToken: cart.checkout_token, recoveryState: cart.recovery_state },
            );
            await tx.execute(
              sql`UPDATE carts SET status = 'completed',
                    recovery_state = ${attribution.recovered ? "recovered" : cart.recovery_state},
                    recovered_order_id = ${attribution.recovered ? order.id : null},
                    recovered_value = ${attribution.recoveredValue ?? null},
                    updated_at = now()
                  WHERE checkout_token = ${order.checkoutToken}`,
            );
          }
        }
        return;
      }

      case SHOPIFY_WEBHOOK_TOPICS.ORDERS_FULFILLED:
      case SHOPIFY_WEBHOOK_TOPICS.FULFILLMENTS_UPDATE:
      case SHOPIFY_WEBHOOK_TOPICS.ORDERS_UPDATED:
      case SHOPIFY_WEBHOOK_TOPICS.ORDERS_CANCELLED: {
        const order = parseOrder(job.payload);
        if (!order) return;
        await tx.execute(
          sql`UPDATE orders_cache SET status = ${order.status}, updated_at = now()
              WHERE shopify_order_id = ${order.id}`,
        );
        return;
      }

      case SHOPIFY_WEBHOOK_TOPICS.PRODUCTS_CREATE:
      case SHOPIFY_WEBHOOK_TOPICS.PRODUCTS_UPDATE: {
        const product = parseProduct(job.payload);
        if (!product) return;
        await tx.execute(
          sql`INSERT INTO products (tenant_id, shopify_product_id, title, body, handle, price_min, price_max, currency, status, variants, updated_at)
              VALUES (${job.tenantId}, ${product.id}, ${product.title}, ${product.body}, ${product.handle},
                      ${product.priceMin}, ${product.priceMax}, ${product.currency}, ${product.status},
                      ${JSON.stringify(product.variants)}::jsonb, now())
              ON CONFLICT (tenant_id, shopify_product_id)
              DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, price_min = EXCLUDED.price_min,
                            price_max = EXCLUDED.price_max, status = EXCLUDED.status,
                            variants = EXCLUDED.variants, updated_at = now()`,
        );
        return;
      }

      case SHOPIFY_WEBHOOK_TOPICS.PRODUCTS_DELETE: {
        const product = parseProduct(job.payload);
        if (!product) return;
        await tx.execute(
          sql`UPDATE products SET status = 'deleted', updated_at = now() WHERE shopify_product_id = ${product.id}`,
        );
        return;
      }

      case SHOPIFY_WEBHOOK_TOPICS.APP_UNINSTALLED: {
        // Offboarding: revoke token immediately; data deletion runs on a retention timer.
        await tx.execute(
          sql`UPDATE shopify_stores SET status = 'uninstalled', access_token_enc = NULL, uninstalled_at = now()
              WHERE shop_domain = ${job.shopDomain}`,
        );
        return;
      }

      case SHOPIFY_WEBHOOK_TOPICS.CUSTOMERS_DATA_REQUEST:
      case SHOPIFY_WEBHOOK_TOPICS.CUSTOMERS_REDACT:
      case SHOPIFY_WEBHOOK_TOPICS.SHOP_REDACT: {
        // Mandatory privacy webhooks: recorded via processed_events; fulfilment
        // pipeline (export / redaction) is a Phase 3 deliverable.
        ctx.logger.info({ topic: job.topic, shop: job.shopDomain }, "privacy webhook received");
        return;
      }

      default:
        ctx.logger.warn({ topic: job.topic }, "unhandled shopify topic");
    }
  });
}

function parseCheckout(payload: unknown): CheckoutSnapshot | null {
  const p = payload as Record<string, unknown> | null;
  if (!p || typeof p["token"] !== "string") return null;
  const lineItems = Array.isArray(p["line_items"])
    ? (p["line_items"] as Array<Record<string, unknown>>).map((li) => ({
        title: String(li["title"] ?? ""),
        quantity: Number(li["quantity"] ?? 1),
        price: String(li["price"] ?? ""),
      }))
    : [];
  return {
    checkoutToken: p["token"],
    phone: typeof p["phone"] === "string" ? p["phone"] : null,
    email: typeof p["email"] === "string" ? p["email"] : null,
    completedAt: typeof p["completed_at"] === "string" ? new Date(p["completed_at"]) : null,
    lineItems,
    totalPrice: typeof p["total_price"] === "string" ? p["total_price"] : null,
    currency: typeof p["currency"] === "string" ? p["currency"] : null,
    abandonedCheckoutUrl: typeof p["abandoned_checkout_url"] === "string" ? p["abandoned_checkout_url"] : null,
  };
}

function parseOrder(payload: unknown) {
  const p = payload as Record<string, unknown> | null;
  if (!p || p["id"] === undefined) return null;
  return {
    id: String(p["id"]),
    orderNumber: p["name"] !== undefined ? String(p["name"]) : null,
    phone: typeof p["phone"] === "string" ? p["phone"] : null,
    status: typeof p["financial_status"] === "string" ? p["financial_status"] : "unknown",
    totalPrice: typeof p["total_price"] === "string" ? p["total_price"] : null,
    currency: typeof p["currency"] === "string" ? p["currency"] : null,
    checkoutToken: typeof p["checkout_token"] === "string" ? p["checkout_token"] : null,
  };
}

function parseProduct(payload: unknown) {
  const p = payload as Record<string, unknown> | null;
  if (!p || p["id"] === undefined) return null;
  const variants = Array.isArray(p["variants"]) ? (p["variants"] as Array<Record<string, unknown>>) : [];
  const prices = variants.map((v) => Number(v["price"])).filter((n) => !Number.isNaN(n));
  return {
    id: String(p["id"]),
    title: String(p["title"] ?? ""),
    body: typeof p["body_html"] === "string" ? p["body_html"] : null,
    handle: typeof p["handle"] === "string" ? p["handle"] : null,
    priceMin: prices.length ? String(Math.min(...prices)) : null,
    priceMax: prices.length ? String(Math.max(...prices)) : null,
    currency: null,
    status: typeof p["status"] === "string" ? p["status"] : "active",
    variants: variants.map((v) => ({
      id: String(v["id"]),
      title: String(v["title"] ?? ""),
      price: String(v["price"] ?? ""),
      inventory: Number(v["inventory_quantity"] ?? 0),
    })),
  };
}
