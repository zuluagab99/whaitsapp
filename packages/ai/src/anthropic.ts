import Anthropic from "@anthropic-ai/sdk";
import type {
  CompletionRequest,
  CompletionResponse,
  LLMProvider,
  ToolCall,
} from "./llm.js";

/** Models that support adaptive thinking (Claude 4.7+ / Sonnet 5 / Fable 5). */
const ADAPTIVE_THINKING_MODELS = /^claude-(opus-4-[78]|sonnet-5|fable-5|opus-4-6|sonnet-4-6)/;

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(opts: { apiKey?: string; client?: Anthropic } = {}) {
    this.client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const response = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 2048,
      system: req.system,
      ...(ADAPTIVE_THINKING_MODELS.test(req.model) ? { thinking: { type: "adaptive" as const } } : {}),
      messages: toAnthropicMessages(req.messages),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
    });

    const toolCalls: ToolCall[] = [];
    let text = "";
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, input: block.input as Record<string, unknown> });
      }
    }

    return {
      text,
      toolCalls,
      stopReason: normalizeStopReason(response.stop_reason),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

function normalizeStopReason(reason: string | null): CompletionResponse["stopReason"] {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

function toAnthropicMessages(messages: CompletionRequest["messages"]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = [];
      if (msg.content) content.push({ type: "text", text: msg.content });
      for (const call of msg.toolCalls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      result.push({ role: "assistant", content });
    } else {
      // Tool results are user-role messages in the Anthropic API. Consecutive
      // tool results are merged into one user message by the API's same-role rule.
      result.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.toolCallId,
            content: msg.content,
            ...(msg.isError ? { is_error: true } : {}),
          },
        ],
      });
    }
  }
  return result;
}
