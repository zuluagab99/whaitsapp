import { describe, expect, it } from "vitest";
import {
  matchesTrigger,
  renderTemplate,
  selectWorkflow,
  workflowDefinitionSchema,
  type Workflow,
} from "../src/index.js";

const wf = (over: Partial<Workflow>): Workflow => ({
  id: "w1",
  name: "test",
  enabled: true,
  trigger: { type: "message_received", match: "any" },
  actions: [{ type: "send_message", text: "hi" }],
  ...over,
});

describe("matchesTrigger", () => {
  it("matches message trigger with no keywords against any text", () => {
    expect(matchesTrigger({ type: "message_received", match: "any" }, { type: "message_received", text: "hola" })).toBe(true);
  });

  it("matches any keyword case-insensitively", () => {
    const t = { type: "message_received" as const, keywords: ["precio", "envío"], match: "any" as const };
    expect(matchesTrigger(t, { type: "message_received", text: "Cuál es el PRECIO?" })).toBe(true);
    expect(matchesTrigger(t, { type: "message_received", text: "hola" })).toBe(false);
  });

  it("requires every keyword with match=all", () => {
    const t = { type: "message_received" as const, keywords: ["cancelar", "pedido"], match: "all" as const };
    expect(matchesTrigger(t, { type: "message_received", text: "quiero cancelar mi pedido" })).toBe(true);
    expect(matchesTrigger(t, { type: "message_received", text: "quiero cancelar" })).toBe(false);
  });

  it("never crosses trigger types", () => {
    expect(matchesTrigger({ type: "order_created" }, { type: "message_received", text: "order" })).toBe(false);
    expect(matchesTrigger({ type: "order_created" }, { type: "order_created" })).toBe(true);
    expect(matchesTrigger({ type: "order_fulfilled" }, { type: "order_created" })).toBe(false);
  });
});

describe("selectWorkflow", () => {
  it("returns the first enabled match, skipping disabled ones", () => {
    const disabled = wf({ id: "a", enabled: false });
    const second = wf({ id: "b", trigger: { type: "message_received", keywords: ["hola"], match: "any" } });
    const third = wf({ id: "c" });
    expect(selectWorkflow([disabled, second, third], { type: "message_received", text: "hola" })?.id).toBe("b");
  });

  it("returns null when nothing matches", () => {
    expect(selectWorkflow([wf({ trigger: { type: "order_created" } })], { type: "message_received", text: "x" })).toBeNull();
  });
});

describe("renderTemplate", () => {
  it("interpolates order variables", () => {
    const out = renderTemplate("Pedido {{order_number}} por {{total_price}} {{currency}} 🎉", {
      type: "order_created",
      orderNumber: "#1001",
      totalPrice: "99.90",
      currency: "COP",
    });
    expect(out).toBe("Pedido #1001 por 99.90 COP 🎉");
  });

  it("renders unknown variables as empty, not raw braces", () => {
    expect(renderTemplate("hola {{nope}}!", { type: "message_received", text: "x" })).toBe("hola !");
  });
});

describe("workflowDefinitionSchema", () => {
  it("accepts a valid definition and applies defaults", () => {
    const parsed = workflowDefinitionSchema.parse({
      name: "FAQ envío",
      trigger: { type: "message_received", keywords: ["envío"] },
      actions: [{ type: "send_message", text: "Enviamos en 24h" }],
    });
    expect(parsed.enabled).toBe(true);
    expect(parsed.trigger).toMatchObject({ match: "any" });
  });

  it("rejects unknown trigger and empty actions", () => {
    expect(() => workflowDefinitionSchema.parse({ name: "x", trigger: { type: "nope" }, actions: [] })).toThrow();
  });
});
