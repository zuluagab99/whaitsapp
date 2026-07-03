import type { ToolDefinition } from "./llm.js";

/**
 * The sales-agent tool surface. Tools are the ONLY path to prices, stock,
 * discounts, and order data — the model must never state these from its own
 * weights (enforced by prompt + guardrail post-check).
 */
export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: "search_products",
    description:
      "Search the merchant's product catalog by natural-language query. Call this whenever the customer asks about products, availability, or prices. Returns matching products with current price and stock from the catalog.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the customer is looking for, in their own words" },
        maxResults: { type: "integer", description: "Max products to return (default 5)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_product_details",
    description:
      "Get full details (variants, price, stock, description, image) for one product by its id. Call this before quoting a specific price or stock level.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "The product id from search_products results" },
      },
      required: ["productId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_order_status",
    description:
      "Look up the status, fulfillment, and tracking of the customer's order. Call this when the customer asks where their order is. Only returns orders belonging to the phone number of this conversation — never expose another customer's order.",
    inputSchema: {
      type: "object",
      properties: {
        orderNumber: { type: "string", description: "Order number if the customer provided one; otherwise omit to search by their phone" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_checkout_link",
    description:
      "Create a checkout link for the items the customer wants to buy. Call this when the customer confirms they want to purchase. Returns a URL to send them.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              variantId: { type: "string" },
              quantity: { type: "integer" },
            },
            required: ["variantId", "quantity"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
  {
    name: "apply_discount",
    description:
      "Apply a discount code to the customer's checkout. Only merchant-configured codes within configured bounds can be applied; requests outside bounds are rejected server-side. Never invent or promise discounts not returned by this tool.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "The discount code the customer provided" },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
  {
    name: "handoff_to_human",
    description:
      "Escalate this conversation to a human agent. Call this when the customer explicitly asks for a person, is frustrated or angry, has a complaint you cannot resolve, or asks something outside your policies. The bot pauses after this call.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Short reason for the handoff, shown to the merchant" },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
  {
    name: "schedule_followup",
    description:
      "Schedule a follow-up message to this customer. Use when the customer asks to be reminded later or the conversation should resume at a specific time.",
    inputSchema: {
      type: "object",
      properties: {
        when: { type: "string", description: "ISO 8601 datetime for the follow-up" },
        intent: { type: "string", description: "What the follow-up should be about" },
      },
      required: ["when", "intent"],
      additionalProperties: false,
    },
  },
];

/** Result of executing one tool. `data` is serialized into the tool_result. */
export interface ToolResult {
  data: unknown;
  isError?: boolean;
}

/**
 * The commerce/db side implements this; the agent loop only knows the interface.
 * Implementations MUST enforce access control (e.g. order lookups verified
 * against the conversation's phone number) — the LLM is untrusted input.
 */
export interface ToolExecutor {
  execute(name: string, input: Record<string, unknown>): Promise<ToolResult>;
}
