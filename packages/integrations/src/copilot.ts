/**
 * The model behind the owner's copilot (brief §6.15). The domain hands it a prompt and tools; the model may only read
 * through those tools and propose actions through them. Nothing it does changes data: proposals wait for the owner.
 */
import Anthropic from '@anthropic-ai/sdk';

export interface CopilotTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

export interface CopilotTraceStep {
  tool: string;
  input: unknown;
  /** The tool's answer, or its error code. */
  output: unknown;
  error?: boolean;
}

export interface CopilotRunInput {
  system: string;
  prompt: string;
  tools: CopilotTool[];
  /** Runs one tool; a thrown error becomes an error result the model sees. */
  callTool(name: string, input: unknown): Promise<unknown>;
}

export interface CopilotRunResult {
  answer: string;
  trace: CopilotTraceStep[];
  /** True when the model stopped for a reason other than finishing (turn limit, refusal, length). */
  incomplete: boolean;
}

export interface CopilotModel {
  readonly name: string;
  run(input: CopilotRunInput): Promise<CopilotRunResult>;
}

/** Runs a tool and records it, turning a failure into an error result. */
export async function traced(
  input: CopilotRunInput,
  trace: CopilotTraceStep[],
  name: string,
  args: unknown,
): Promise<{ text: string; error: boolean }> {
  try {
    const output = await input.callTool(name, args);
    trace.push({ tool: name, input: args, output });
    return { text: JSON.stringify(output), error: false };
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    const output = typeof code === 'string' ? code : 'copilot.errors.toolFailed';
    trace.push({ tool: name, input: args, output, error: true });
    return { text: JSON.stringify({ error: output }), error: true };
  }
}

/**
 * Claude with the copilot's tools, in a manual loop so every tool runs inside the owner's own database transaction.
 * Used when the copilot policy is on and the web app has ANTHROPIC_API_KEY.
 */
export class ClaudeCopilotModel implements CopilotModel {
  readonly name: string;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTurns: number;

  constructor(
    opts: { apiKey?: string; model?: string; client?: Anthropic; maxTurns?: number } = {},
  ) {
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? 'claude-opus-5-5';
    this.name = `claude:${this.model}`;
    this.maxTurns = opts.maxTurns ?? 8;
  }

  async run(input: CopilotRunInput): Promise<CopilotRunResult> {
    const trace: CopilotTraceStep[] = [];
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: input.prompt }];
    for (let turn = 0; turn < this.maxTurns; turn++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system: input.system,
        tools: input.tools,
        messages,
      });
      const text = response.content
        .flatMap((b) => (b.type === 'text' ? [b.text] : []))
        .join('\n')
        .trim();
      if (response.stop_reason !== 'tool_use') {
        return { answer: text, trace, incomplete: response.stop_reason !== 'end_turn' };
      }
      messages.push({ role: 'assistant', content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const r = await traced(input, trace, block.name, block.input);
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: r.text,
          is_error: r.error,
        });
      }
      messages.push({ role: 'user', content: results });
    }
    return { answer: '', trace, incomplete: true };
  }
}
