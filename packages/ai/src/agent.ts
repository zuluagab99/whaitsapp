import type { ChatMessage, CompletionUsage } from "./llm.js";
import type { ModelRouter, RouterConfig } from "./router.js";
import { AGENT_TOOLS, type ToolExecutor } from "./tools.js";
import { checkReplyGuardrails, type GuardrailFinding } from "./guardrails.js";
import { buildSystemPrompt, type BotConfig } from "./prompt.js";

export interface AgentRunInput {
  botConfig: BotConfig;
  /** Sliding window of prior conversation (persisted transcripts live in the DB). */
  history: ChatMessage[];
  /** Optional running summary of older history. */
  summary?: string;
  inboundText: string;
  /** Per-tenant model routing (from tenants.settings.llm); platform defaults when absent. */
  routerConfig?: RouterConfig;
  /** Extra system-prompt instructions injected by a matched workflow's ai_reply action. */
  extraInstructions?: string;
}

export interface AgentRunResult {
  reply: string;
  /** True when handoff_to_human was called — the caller must pause the bot. */
  handoff: boolean;
  handoffReason?: string;
  toolCallsMade: Array<{ name: string; input: Record<string, unknown> }>;
  guardrailFindings: GuardrailFinding[];
  usage: CompletionUsage;
}

const MAX_TOOL_ITERATIONS = 8;

/**
 * The agent loop: LLM call with tools → execute tool calls → loop until a
 * final text answer → guardrail post-check. Same pattern as the reference
 * repo, productionized: bounded iterations, handoff signaling, usage metering.
 */
export async function runAgent(
  router: ModelRouter,
  executor: ToolExecutor,
  input: AgentRunInput,
): Promise<AgentRunResult> {
  let system = buildSystemPrompt(input.botConfig);
  if (input.extraInstructions) {
    system += `\n\nAdditional instructions for this conversation:\n${input.extraInstructions}`;
  }
  const messages: ChatMessage[] = [...input.history];
  if (input.summary) {
    messages.unshift({ role: "user", content: `[Conversation summary so far: ${input.summary}]` });
  }
  messages.push({ role: "user", content: input.inboundText });

  const usage: CompletionUsage = { inputTokens: 0, outputTokens: 0 };
  const toolOutputs: string[] = [];
  const toolCallsMade: AgentRunResult["toolCallsMade"] = [];
  let handoff = false;
  let handoffReason: string | undefined;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await router.complete(
      "conversation",
      { system, messages, tools: AGENT_TOOLS, maxTokens: 1024 },
      input.routerConfig,
    );
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;

    if (response.stopReason !== "tool_use" || response.toolCalls.length === 0) {
      const guardrail = checkReplyGuardrails({ reply: response.text, toolOutputs });
      return {
        reply: response.text,
        handoff,
        ...(handoffReason !== undefined ? { handoffReason } : {}),
        toolCallsMade,
        guardrailFindings: guardrail.findings,
        usage,
      };
    }

    messages.push({ role: "assistant", content: response.text, toolCalls: response.toolCalls });

    for (const call of response.toolCalls) {
      toolCallsMade.push({ name: call.name, input: call.input });
      if (call.name === "handoff_to_human") {
        handoff = true;
        handoffReason = typeof call.input.reason === "string" ? call.input.reason : "unspecified";
      }
      let serialized: string;
      let isError = false;
      try {
        const result = await executor.execute(call.name, call.input);
        serialized = JSON.stringify(result.data);
        isError = result.isError ?? false;
      } catch (err) {
        serialized = `tool execution failed: ${err instanceof Error ? err.message : String(err)}`;
        isError = true;
      }
      if (!isError) toolOutputs.push(serialized);
      messages.push({ role: "tool", toolCallId: call.id, content: serialized, ...(isError ? { isError } : {}) });
    }
  }

  // Iteration cap hit — fail safe to a human rather than looping forever.
  return {
    reply: "",
    handoff: true,
    handoffReason: "agent exceeded tool iteration limit",
    toolCallsMade,
    guardrailFindings: [],
    usage,
  };
}
