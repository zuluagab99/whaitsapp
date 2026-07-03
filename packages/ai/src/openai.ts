import OpenAI from "openai";
import type {
  CompletionRequest,
  CompletionResponse,
  LLMProvider,
  ToolCall,
} from "./llm.js";

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private readonly client: OpenAI;

  constructor(opts: { apiKey?: string; client?: OpenAI } = {}) {
    this.client = opts.client ?? new OpenAI(opts.apiKey ? { apiKey: opts.apiKey } : {});
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const response = await this.client.chat.completions.create({
      model: req.model,
      max_completion_tokens: req.maxTokens ?? 2048,
      messages: [{ role: "system" as const, content: req.system }, ...toOpenAIMessages(req.messages)],
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              type: "function" as const,
              function: { name: t.name, description: t.description, parameters: t.inputSchema },
            })),
          }
        : {}),
    });

    const choice = response.choices[0];
    const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? [])
      .filter((c): c is OpenAI.Chat.ChatCompletionMessageToolCall & { type: "function" } => c.type === "function")
      .map((c) => ({
        id: c.id,
        name: c.function.name,
        input: JSON.parse(c.function.arguments || "{}") as Record<string, unknown>,
      }));

    return {
      text: choice?.message.content ?? "",
      toolCalls,
      stopReason: normalizeFinishReason(choice?.finish_reason),
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}

function normalizeFinishReason(reason: string | undefined | null): CompletionResponse["stopReason"] {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return "other";
  }
}

function toOpenAIMessages(
  messages: CompletionRequest["messages"],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((msg): OpenAI.Chat.ChatCompletionMessageParam => {
    if (msg.role === "user") return { role: "user", content: msg.content };
    if (msg.role === "assistant") {
      return {
        role: "assistant",
        content: msg.content || null,
        ...(msg.toolCalls?.length
          ? {
              tool_calls: msg.toolCalls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            }
          : {}),
      };
    }
    return { role: "tool", tool_call_id: msg.toolCallId, content: msg.content };
  });
}
