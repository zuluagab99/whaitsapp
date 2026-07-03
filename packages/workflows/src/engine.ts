import type { Workflow, WorkflowEvent, WorkflowTrigger } from "./types.js";

/** Does this trigger fire for this event? Pure function — trivially testable. */
export function matchesTrigger(trigger: WorkflowTrigger, event: WorkflowEvent): boolean {
  if (trigger.type !== event.type) return false;
  if (trigger.type !== "message_received" || event.type !== "message_received") return true;

  const keywords = trigger.keywords ?? [];
  if (keywords.length === 0) return true;
  const text = event.text.toLowerCase();
  const hit = (kw: string) => text.includes(kw.toLowerCase());
  return trigger.match === "all" ? keywords.every(hit) : keywords.some(hit);
}

/**
 * Select the workflow to run for an event. Deterministic: first enabled match
 * in the given order wins (callers order by created_at), so merchants can
 * reason about precedence and two workflows never double-reply.
 */
export function selectWorkflow(workflows: Workflow[], event: WorkflowEvent): Workflow | null {
  return workflows.find((w) => w.enabled && matchesTrigger(w.trigger, event)) ?? null;
}

/**
 * Interpolate {{variable}} placeholders from the event. Unknown variables
 * render as empty strings rather than leaking raw braces to customers.
 */
export function renderTemplate(text: string, event: WorkflowEvent): string {
  const vars: Record<string, string | undefined> =
    event.type === "message_received"
      ? { message: event.text }
      : {
          order_number: event.orderNumber,
          total_price: event.totalPrice,
          currency: event.currency,
          tracking_number: event.trackingNumber,
          tracking_url: event.trackingUrl,
        };
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, name: string) => vars[name.toLowerCase()] ?? "");
}
