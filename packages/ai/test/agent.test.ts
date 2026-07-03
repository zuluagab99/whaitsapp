import { describe, expect, it } from "vitest";
import { runAgent } from "../src/agent.js";
import { ModelRouter } from "../src/router.js";
import type { CompletionRequest, CompletionResponse, LLMProvider } from "../src/llm.js";
import type { ToolExecutor } from "../src/tools.js";

/** Scripted fake provider: returns queued responses in order. */
class FakeProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly requests: CompletionRequest[] = [];
  constructor(private readonly script: CompletionResponse[]) {}
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(req);
    const next = this.script.shift();
    if (!next) throw new Error("fake provider script exhausted");
    return next;
  }
}

const usage = { inputTokens: 100, outputTokens: 50 };

function makeRouter(script: CompletionResponse[]) {
  const provider = new FakeProvider(script);
  const router = new ModelRouter().register(provider);
  return { router, provider };
}

const executorCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
const executor: ToolExecutor = {
  async execute(name, input) {
    executorCalls.push({ name, input });
    if (name === "search_products") {
      return { data: [{ id: "p1", title: "Camiseta azul", price: "59900", currency: "COP" }] };
    }
    if (name === "handoff_to_human") return { data: { ok: true } };
    return { data: { ok: true } };
  },
};

const botConfig = { storeName: "Tienda Azul", language: "es" as const };

describe("runAgent", () => {
  it("executes a tool round-trip and returns the final reply", async () => {
    const { router, provider } = makeRouter([
      {
        text: "",
        toolCalls: [{ id: "t1", name: "search_products", input: { query: "camiseta azul" } }],
        stopReason: "tool_use",
        usage,
      },
      {
        text: "¡Sí! La camiseta azul cuesta $59.900 COP. ¿Te la envío?",
        toolCalls: [],
        stopReason: "end_turn",
        usage,
      },
    ]);

    const result = await runAgent(router, executor, {
      botConfig,
      history: [],
      inboundText: "¿Tienen la camiseta azul?",
    });

    expect(result.reply).toContain("59.900");
    expect(result.handoff).toBe(false);
    expect(result.toolCallsMade).toEqual([{ name: "search_products", input: { query: "camiseta azul" } }]);
    expect(result.guardrailFindings).toEqual([]);
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 100 });

    // Second LLM call must include the assistant tool call and the tool result.
    const second = provider.requests[1]!;
    const roles = second.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool"]);
  });

  it("surfaces guardrail findings for invented prices", async () => {
    const { router } = makeRouter([
      { text: "Cuesta solo $9.99, ¡aprovecha!", toolCalls: [], stopReason: "end_turn", usage },
    ]);
    const result = await runAgent(router, executor, {
      botConfig,
      history: [],
      inboundText: "¿Cuánto cuesta?",
    });
    expect(result.guardrailFindings).not.toHaveLength(0);
  });

  it("signals handoff when the model escalates", async () => {
    const { router } = makeRouter([
      {
        text: "",
        toolCalls: [{ id: "t1", name: "handoff_to_human", input: { reason: "customer requested human" } }],
        stopReason: "tool_use",
        usage,
      },
      {
        text: "Te comunico con una persona de nuestro equipo, un momento por favor.",
        toolCalls: [],
        stopReason: "end_turn",
        usage,
      },
    ]);
    const result = await runAgent(router, executor, {
      botConfig,
      history: [],
      inboundText: "Quiero hablar con una persona",
    });
    expect(result.handoff).toBe(true);
    expect(result.handoffReason).toBe("customer requested human");
  });

  it("fails safe to handoff when the tool loop never terminates", async () => {
    const looping: CompletionResponse = {
      text: "",
      toolCalls: [{ id: "t", name: "search_products", input: { query: "x" } }],
      stopReason: "tool_use",
      usage,
    };
    const { router } = makeRouter(Array.from({ length: 20 }, () => ({ ...looping })));
    const result = await runAgent(router, executor, { botConfig, history: [], inboundText: "hola" });
    expect(result.handoff).toBe(true);
    expect(result.handoffReason).toMatch(/iteration limit/);
  });
});
