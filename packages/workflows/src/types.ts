import { z } from "zod";

/**
 * Merchant-defined automation: WHEN a trigger fires, DO a list of actions.
 * Definitions are data (jsonb in the workflows table), validated here at the
 * API boundary and re-validated defensively before execution in the worker.
 */

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message_received"),
    /** Case-insensitive keywords matched against the inbound text. Empty/absent = match every message. */
    keywords: z.array(z.string().min(1)).max(50).optional(),
    /** any (default): one keyword suffices; all: every keyword must appear. */
    match: z.enum(["any", "all"]).default("any"),
  }),
  z.object({ type: z.literal("order_created") }),
  z.object({ type: z.literal("order_fulfilled") }),
]);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("send_message"),
    /** Freeform text; {{variables}} are interpolated from the trigger event. */
    text: z.string().min(1).max(4096),
  }),
  z.object({
    type: z.literal("ai_reply"),
    /** Extra instructions appended to the agent's system prompt for this reply. */
    instructions: z.string().max(2000).optional(),
  }),
  z.object({
    type: z.literal("handoff"),
    /** Optional message sent to the customer before pausing the bot. */
    text: z.string().max(4096).optional(),
  }),
]);

export const workflowDefinitionSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  trigger: triggerSchema,
  actions: z.array(actionSchema).min(1).max(5),
});

export type WorkflowTrigger = z.infer<typeof triggerSchema>;
export type WorkflowAction = z.infer<typeof actionSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

/** A stored workflow row as loaded from the DB. */
export interface Workflow extends WorkflowDefinition {
  id: string;
}

/** The event a trigger is evaluated against. */
export type WorkflowEvent =
  | { type: "message_received"; text: string }
  | {
      type: "order_created" | "order_fulfilled";
      orderNumber?: string;
      totalPrice?: string;
      currency?: string;
      trackingNumber?: string;
      trackingUrl?: string;
    };
