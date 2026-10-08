/**
 * Claude's words on the owner's insights feed: for each thing the daily check noticed, a short Hebrew explanation of
 * why it matters and one concrete next step. Advisory only: the model gets the facts and returns text, nothing else.
 */
import Anthropic from '@anthropic-ai/sdk';

export interface InsightForNote {
  id: string;
  kind: string;
  severity: string;
  params: Record<string, string | number>;
  detail: unknown[];
}

export interface InsightNoteText {
  id: string;
  explanation: string;
  recommendation: string;
}

export interface InsightWriter {
  readonly name: string;
  write(input: { today: string; insights: InsightForNote[] }): Promise<InsightNoteText[]>;
}

const SYSTEM = `You help the owner of a swim school in Israel run the business. A daily check found the items below
(kind, severity, numbers, and the families, groups or lessons behind them). For each item write, in natural Hebrew
addressed to the owner:
- explanation: one or two sentences on what is going on and why it matters for the business, using the numbers given.
- recommendation: one concrete next step the owner or the office can take this week (a call, a message, a schedule
  change, a decision to make). Advice only: never claim anything was done.
Kinds: group_emptying (a group lost places), churn_risk (children missing lessons in a row, frozen places or old
debts), leaving (families that asked to leave, with a reason), old_debts, venue_loss (a pool cost more than it brought
in last month), waitlist_cluster (enough families waiting to open a group), trial_followup (trial lessons held with no
sign-up yet), uncovered_lessons (lessons in the coming week with no instructor), staff_overload (an instructor's hours
this week). Amounts are in agorot (100 agorot = 1 shekel); write them in shekels. Weekday 0 is Sunday. Use only the
facts given; do not invent names or numbers. Return one entry per item, with its id.`;

/** Claude, one call for the whole feed. Used by the worker when it has ANTHROPIC_API_KEY and the policy allows it. */
export class ClaudeInsightWriter implements InsightWriter {
  readonly name: string;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: { apiKey?: string; model?: string; client?: Anthropic } = {}) {
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? 'claude-opus-5-5';
    this.name = `claude:${this.model}`;
  }

  async write(input: { today: string; insights: InsightForNote[] }): Promise<InsightNoteText[]> {
    if (input.insights.length === 0) return [];
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8000,
      system: SYSTEM,
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['notes'],
            properties: {
              notes: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'explanation', 'recommendation'],
                  properties: {
                    id: { type: 'string' },
                    explanation: { type: 'string' },
                    recommendation: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    });
    if (response.stop_reason !== 'end_turn') return [];
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return [];
    try {
      const ids = new Set(input.insights.map((i) => i.id));
      return ((JSON.parse(text.text) as { notes: InsightNoteText[] }).notes ?? []).filter(
        (n) => ids.has(n.id) && n.explanation.trim() && n.recommendation.trim(),
      );
    } catch {
      return [];
    }
  }
}
