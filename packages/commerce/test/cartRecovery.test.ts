import { describe, expect, it } from "vitest";
import {
  attributeRecovery,
  decideRecoveryRun,
  shouldScheduleRecovery,
  DEFAULT_RECOVERY_DELAY_MS,
  type CheckoutSnapshot,
} from "../src/cartRecovery.js";

const baseCheckout: CheckoutSnapshot = {
  checkoutToken: "tok_1",
  phone: "+573001112233",
  email: "ana@example.com",
  completedAt: null,
  lineItems: [{ title: "Camiseta azul", quantity: 1, price: "59900" }],
  totalPrice: "59900",
  currency: "COP",
  abandonedCheckoutUrl: "https://store.myshopify.com/checkouts/tok_1/recover",
};

describe("shouldScheduleRecovery", () => {
  it("schedules with the default delay for an abandonable checkout", () => {
    expect(shouldScheduleRecovery(baseCheckout)).toEqual({ schedule: true, delayMs: DEFAULT_RECOVERY_DELAY_MS });
  });

  it("skips completed checkouts", () => {
    expect(shouldScheduleRecovery({ ...baseCheckout, completedAt: new Date() })).toMatchObject({ schedule: false });
  });

  it("skips checkouts without a phone", () => {
    expect(shouldScheduleRecovery({ ...baseCheckout, phone: null })).toMatchObject({
      schedule: false,
      reason: expect.stringContaining("phone"),
    });
  });

  it("skips empty carts and already-scheduled carts", () => {
    expect(shouldScheduleRecovery({ ...baseCheckout, lineItems: [] })).toMatchObject({ schedule: false });
    expect(shouldScheduleRecovery(baseCheckout, { alreadyScheduled: true })).toMatchObject({ schedule: false });
  });
});

describe("decideRecoveryRun", () => {
  it("sends when cart is open, scheduled, and contact opted in", () => {
    expect(
      decideRecoveryRun({ cartStatus: "open", contactOptIn: true, recoveryState: "scheduled" }),
    ).toEqual({ action: "send_template" });
  });

  it("cancels when the checkout completed in the meantime", () => {
    expect(
      decideRecoveryRun({ cartStatus: "completed", contactOptIn: true, recoveryState: "scheduled" }),
    ).toMatchObject({ action: "skip", reason: expect.stringContaining("completed") });
  });

  it("never sends marketing to a contact without opt-in", () => {
    expect(
      decideRecoveryRun({ cartStatus: "open", contactOptIn: false, recoveryState: "scheduled" }),
    ).toMatchObject({ action: "skip", reason: expect.stringContaining("opt") });
  });
});

describe("attributeRecovery", () => {
  it("attributes an order matching the checkout token after a sent recovery", () => {
    expect(
      attributeRecovery(
        { checkoutToken: "tok_1", totalPrice: "59900" },
        { checkoutToken: "tok_1", recoveryState: "sent" },
      ),
    ).toEqual({ recovered: true, recoveredValue: "59900" });
  });

  it("does not attribute mismatched tokens or unsent recoveries", () => {
    expect(
      attributeRecovery({ checkoutToken: "other", totalPrice: "1" }, { checkoutToken: "tok_1", recoveryState: "sent" }),
    ).toEqual({ recovered: false });
    expect(
      attributeRecovery({ checkoutToken: "tok_1", totalPrice: "1" }, { checkoutToken: "tok_1", recoveryState: "none" }),
    ).toEqual({ recovered: false });
  });
});
