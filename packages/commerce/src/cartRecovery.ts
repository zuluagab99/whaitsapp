/**
 * Abandoned-cart recovery pipeline decision logic (pure, unit-testable).
 * The worker wires these decisions to BullMQ delayed jobs and template sends.
 */

export const DEFAULT_RECOVERY_DELAY_MS = 45 * 60 * 1000;

export interface CheckoutSnapshot {
  checkoutToken: string;
  phone: string | null;
  email: string | null;
  completedAt: Date | null;
  lineItems: Array<{ title: string; quantity: number; price: string }>;
  totalPrice: string | null;
  currency: string | null;
  abandonedCheckoutUrl: string | null;
}

export type ScheduleDecision =
  | { schedule: true; delayMs: number }
  | { schedule: false; reason: string };

/** Decide whether a checkouts/create|update event should schedule a recovery job. */
export function shouldScheduleRecovery(
  checkout: CheckoutSnapshot,
  opts: { delayMs?: number; alreadyScheduled?: boolean } = {},
): ScheduleDecision {
  if (checkout.completedAt) return { schedule: false, reason: "checkout already completed" };
  if (!checkout.phone) return { schedule: false, reason: "no phone number on checkout" };
  if (!checkout.lineItems.length) return { schedule: false, reason: "cart is empty" };
  if (opts.alreadyScheduled) return { schedule: false, reason: "recovery already scheduled" };
  return { schedule: true, delayMs: opts.delayMs ?? DEFAULT_RECOVERY_DELAY_MS };
}

export interface RecoveryRunContext {
  cartStatus: "open" | "completed" | "expired";
  contactOptIn: boolean;
  recoveryState: "none" | "scheduled" | "sent" | "replied" | "recovered" | "expired";
}

export type RecoveryRunDecision =
  | { action: "send_template" }
  | { action: "skip"; reason: string };

/** Decide, at job execution time, whether the recovery template should actually go out. */
export function decideRecoveryRun(ctx: RecoveryRunContext): RecoveryRunDecision {
  if (ctx.cartStatus === "completed") return { action: "skip", reason: "checkout completed before send" };
  if (ctx.cartStatus === "expired") return { action: "skip", reason: "cart expired" };
  if (ctx.recoveryState !== "scheduled") {
    return { action: "skip", reason: `unexpected recovery state: ${ctx.recoveryState}` };
  }
  // Cart recovery is a marketing-category template: Meta policy + Habeas Data/GDPR require opt-in.
  if (!ctx.contactOptIn) return { action: "skip", reason: "contact has not opted in" };
  return { action: "send_template" };
}

export interface RecoveredAttribution {
  recovered: boolean;
  recoveredValue?: string;
}

/**
 * Attribution: an order completing with the same checkout token after a
 * recovery message was sent counts as recovered revenue — the headline metric.
 */
export function attributeRecovery(
  order: { checkoutToken: string | null; totalPrice: string | null },
  cart: { checkoutToken: string; recoveryState: string },
): RecoveredAttribution {
  if (!order.checkoutToken || order.checkoutToken !== cart.checkoutToken) return { recovered: false };
  if (cart.recoveryState !== "sent" && cart.recoveryState !== "replied") return { recovered: false };
  return { recovered: true, ...(order.totalPrice ? { recoveredValue: order.totalPrice } : {}) };
}
