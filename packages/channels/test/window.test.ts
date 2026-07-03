import { describe, expect, it } from "vitest";
import { checkSendPolicy, isWithinServiceWindow } from "../src/window.js";

const NOW = new Date("2026-07-03T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

describe("isWithinServiceWindow", () => {
  it("is true within 24h of last inbound", () => {
    expect(isWithinServiceWindow({ lastInboundAt: hoursAgo(23.9), now: NOW })).toBe(true);
  });
  it("is false at/after 24h", () => {
    expect(isWithinServiceWindow({ lastInboundAt: hoursAgo(24), now: NOW })).toBe(false);
    expect(isWithinServiceWindow({ lastInboundAt: hoursAgo(48), now: NOW })).toBe(false);
  });
  it("is false when the contact never wrote in", () => {
    expect(isWithinServiceWindow({ lastInboundAt: null, now: NOW })).toBe(false);
  });
});

describe("checkSendPolicy", () => {
  it("allows freeform inside the window", () => {
    expect(checkSendPolicy({ kind: "freeform", optIn: false, lastInboundAt: hoursAgo(1), now: NOW })).toEqual({
      allowed: true,
    });
  });

  it("blocks freeform outside the window", () => {
    const decision = checkSendPolicy({ kind: "freeform", optIn: true, lastInboundAt: hoursAgo(30), now: NOW });
    expect(decision.allowed).toBe(false);
  });

  it("allows utility templates outside the window", () => {
    expect(
      checkSendPolicy({ kind: "template_utility", optIn: false, lastInboundAt: null, now: NOW }),
    ).toEqual({ allowed: true });
  });

  it("blocks marketing templates without opt-in (cart recovery gate)", () => {
    const decision = checkSendPolicy({ kind: "template_marketing", optIn: false, lastInboundAt: null, now: NOW });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/opt/);
  });

  it("allows marketing templates with opt-in", () => {
    expect(checkSendPolicy({ kind: "template_marketing", optIn: true, lastInboundAt: null, now: NOW })).toEqual({
      allowed: true,
    });
  });
});
