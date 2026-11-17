/**
 * Claude's guess at which column of an uploaded file is which field (SaaS stage 5), for the columns the header rules
 * could not place. It sees the column names and two sample values with every digit masked, never whole rows. Per
 * decision 8 a simple task runs on the small model. The owner confirms or corrects the result before anything is saved.
 */
import { AI_MODEL_FOR } from '@rswim/contracts';
import Anthropic from '@anthropic-ai/sdk';
import { reportUsage } from './usage';

export interface ColumnForSuggestion {
  index: number;
  header: string;
  samples: string[];
}

export interface ColumnSuggester {
  readonly name: string;
  /** Column index → field key ('' = none). Only fields from `fields` come back. */
  suggest(input: {
    kind: string;
    fields: readonly string[];
    columns: ColumnForSuggestion[];
  }): Promise<Record<string, string>>;
}

const SYSTEM = `You map the columns of a spreadsheet that an Israeli swim school or freediving club exported from its
previous system to the fields of a new system. Headers and values are mostly Hebrew. Each column comes with its header
and up to two sample values (digits are masked as #). For each column return the one field it holds, or "" when it
holds none of them or you are unsure. Use each field at most once. Field meanings: parent* = the paying parent or
guardian, parent2* = a second parent, child* = the child who swims, *FullName = first and last name in one cell,
balance = money the family owes, level = swimming or certification level, group = the class or group name,
certLevel = freediving certification level, employmentType = employee or self-employed.`;

/** Masks every digit, so phone numbers, ids and amounts never leave the server. */
export function maskSample(value: string): string {
  return value.replace(/\d/g, '#').slice(0, 40);
}

export class ClaudeColumnSuggester implements ColumnSuggester {
  readonly name: string;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: { apiKey?: string; model?: string; client?: Anthropic } = {}) {
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? AI_MODEL_FOR.import_columns;
    this.name = `claude:${this.model}`;
  }

  async suggest(input: {
    kind: string;
    fields: readonly string[];
    columns: ColumnForSuggestion[];
  }): Promise<Record<string, string>> {
    if (input.columns.length === 0) return {};
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4000,
      system: SYSTEM,
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['columns'],
            properties: {
              columns: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['index', 'field'],
                  properties: {
                    index: { type: 'integer' },
                    field: { type: 'string', enum: ['', ...input.fields] },
                  },
                },
              },
            },
          },
        },
      },
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            kind: input.kind,
            fields: input.fields,
            columns: input.columns.map((c) => ({
              index: c.index,
              header: c.header,
              samples: c.samples.map(maskSample),
            })),
          }),
        },
      ],
    });
    reportUsage(this.model, response.usage);
    if (response.stop_reason !== 'end_turn') return {};
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return {};
    try {
      const parsed = JSON.parse(text.text) as { columns?: { index: number; field: string }[] };
      const allowed = new Set(input.fields);
      const out: Record<string, string> = {};
      for (const c of parsed.columns ?? []) {
        if (allowed.has(c.field)) out[String(c.index)] = c.field;
      }
      return out;
    } catch {
      return {};
    }
  }
}
