import { sql } from "@whaitsapp/db";
import type { Database } from "@whaitsapp/db";
import type { ToolExecutor, ToolResult } from "@whaitsapp/ai";

export interface ExecutorScope {
  tenantId: string;
  contactPhone: string;
  conversationId: string;
}

/**
 * Tenant-scoped tool executor. Runs inside a tenantTransaction, so RLS already
 * confines every query — but order access is additionally verified against the
 * conversation's phone number: the LLM must not be able to leak another
 * customer's order even within the same tenant.
 */
export function createToolExecutor(tx: Database, scope: ExecutorScope): ToolExecutor {
  return {
    async execute(name, input): Promise<ToolResult> {
      switch (name) {
        case "search_products": {
          const query = String(input.query ?? "");
          const limit = Math.min(Number(input.maxResults ?? 5), 10);
          // Lexical search for now; pgvector semantic search lands with embeddings sync.
          const rows = await tx.execute(
            sql`SELECT id, shopify_product_id, title, price_min, price_max, currency, inventory_quantity
                FROM products
                WHERE status = 'active' AND (title ILIKE ${"%" + query + "%"} OR body ILIKE ${"%" + query + "%"})
                ORDER BY updated_at DESC
                LIMIT ${limit}`,
          );
          return { data: rows.rows };
        }
        case "get_product_details": {
          const rows = await tx.execute(
            sql`SELECT id, shopify_product_id, title, body, price_min, price_max, currency,
                       inventory_quantity, image_url, variants
                FROM products WHERE id = ${String(input.productId ?? "")}`,
          );
          if (!rows.rows.length) return { data: { error: "product not found" }, isError: true };
          return { data: rows.rows[0] };
        }
        case "get_order_status": {
          // Access control: only orders whose customer phone matches this
          // conversation's contact. Order-number lookups are constrained the same way.
          const orderNumber = input.orderNumber ? String(input.orderNumber) : null;
          const rows = await tx.execute(
            sql`SELECT order_number, status, fulfillment_status, tracking_number, tracking_url, total_price, currency
                FROM orders_cache
                WHERE regexp_replace(customer_phone, '\\D', '', 'g') = regexp_replace(${scope.contactPhone}, '\\D', '', 'g')
                  AND (${orderNumber}::text IS NULL OR order_number = ${orderNumber})
                ORDER BY updated_at DESC
                LIMIT 3`,
          );
          if (!rows.rows.length) {
            return {
              data: {
                message:
                  "No orders found for this phone number. Ask the customer for their order number and the email used at purchase before escalating.",
              },
            };
          }
          return { data: rows.rows };
        }
        case "create_checkout_link": {
          // Draft-order creation via Shopify lands in Phase 3; return a clear
          // signal so the model apologizes instead of inventing a URL.
          return { data: { error: "checkout link creation not yet enabled for this store" }, isError: true };
        }
        case "apply_discount": {
          const code = String(input.code ?? "");
          return {
            data: { error: `discount code "${code}" could not be validated — discounts are not enabled yet` },
            isError: true,
          };
        }
        case "handoff_to_human": {
          await tx.execute(
            sql`UPDATE conversations SET status = 'human' WHERE id = ${scope.conversationId}`,
          );
          return { data: { ok: true, message: "conversation handed to a human agent" } };
        }
        case "schedule_followup": {
          // Follow-up scheduling job lands with campaigns; acknowledge without promising.
          return { data: { error: "follow-up scheduling not yet enabled" }, isError: true };
        }
        default:
          return { data: { error: `unknown tool: ${name}` }, isError: true };
      }
    },
  };
}
