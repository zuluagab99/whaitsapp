import { describe, expect, it } from "vitest";
import { checkReplyGuardrails } from "../src/guardrails.js";

describe("checkReplyGuardrails", () => {
  it("passes prices that came from tool output", () => {
    const result = checkReplyGuardrails({
      reply: "La camiseta azul cuesta $59.900 COP.",
      toolOutputs: ['{"title":"Camiseta azul","price":"59900","currency":"COP"}'],
    });
    expect(result.ok).toBe(true);
  });

  it("flags a price invented by the model", () => {
    const result = checkReplyGuardrails({
      reply: "It costs $19.99!",
      toolOutputs: ['{"title":"Camiseta azul","price":"59900"}'],
    });
    expect(result.ok).toBe(false);
    expect(result.findings[0]).toMatchObject({ kind: "unverified_price" });
  });

  it("flags a discount not present in tool output", () => {
    const result = checkReplyGuardrails({
      reply: "Te puedo dar un 50% de descuento hoy.",
      toolOutputs: [],
    });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.kind === "unverified_discount")).toBe(true);
  });

  it("passes a discount that the apply_discount tool confirmed", () => {
    const result = checkReplyGuardrails({
      reply: "¡Listo! Apliqué tu 10% de descuento.",
      toolOutputs: ['{"code":"HOLA10","percentOff":10,"applied":true}'],
    });
    expect(result.ok).toBe(true);
  });

  it("passes replies with no numeric claims", () => {
    const result = checkReplyGuardrails({
      reply: "¡Hola! ¿En qué puedo ayudarte hoy?",
      toolOutputs: [],
    });
    expect(result.ok).toBe(true);
  });
});
