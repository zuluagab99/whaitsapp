/**
 * WhatsApp 24-hour customer service window policy.
 *
 * Free-form messages are only allowed within 24h of the contact's last inbound
 * message. Outside the window, only pre-approved template messages may be sent
 * — and marketing templates additionally require opt-in. Every outbound send
 * MUST route through this check.
 */

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WindowCheckInput {
  lastInboundAt: Date | null;
  now?: Date;
}

export function isWithinServiceWindow({ lastInboundAt, now = new Date() }: WindowCheckInput): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS;
}

export type OutboundKind = "freeform" | "template_utility" | "template_marketing";

export interface SendPolicyInput extends WindowCheckInput {
  kind: OutboundKind;
  optIn: boolean;
}

export type SendDecision = { allowed: true } | { allowed: false; reason: string };

export function checkSendPolicy(input: SendPolicyInput): SendDecision {
  const inWindow = isWithinServiceWindow(input);
  switch (input.kind) {
    case "freeform":
      return inWindow
        ? { allowed: true }
        : { allowed: false, reason: "outside 24h service window; use an approved template" };
    case "template_utility":
      return { allowed: true };
    case "template_marketing":
      return input.optIn
        ? { allowed: true }
        : { allowed: false, reason: "contact has not opted in to marketing messages" };
  }
}
