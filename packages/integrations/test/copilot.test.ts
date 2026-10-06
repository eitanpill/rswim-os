import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { ClaudeCopilotModel, type CopilotRunInput } from '../src/copilot';

const tools: CopilotRunInput['tools'] = [
  {
    name: 'find_students',
    description: 'Find children by name',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

const scripted = (responses: unknown[]) => {
  const calls: { messages: unknown[] }[] = [];
  const client = {
    messages: {
      create: async (p: { messages: unknown[] }) => {
        calls.push({ ...p, messages: [...p.messages] });
        return responses.shift();
      },
    },
  };
  return { calls, client: client as unknown as Anthropic };
};

describe('ClaudeCopilotModel', () => {
  it('runs the tools the model asks for, feeds back results and errors, and returns its answer', async () => {
    const { calls, client } = scripted([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'thinking', thinking: '', signature: 's' },
          { type: 'tool_use', id: 't1', name: 'find_students', input: { query: 'יואב' } },
          { type: 'tool_use', id: 't2', name: 'find_students', input: { query: 'boom' } },
          { type: 'tool_use', id: 't3', name: 'find_students', input: { query: 'crash' } },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'מצאתי את יואב.' }] },
    ]);
    const model = new ClaudeCopilotModel({ client });
    expect(model.name).toBe('claude:claude-opus-5-5');
    const out = await model.run({
      system: 'sys',
      prompt: 'איפה יואב?',
      tools,
      callTool: async (_name, input) => {
        const q = (input as { query: string }).query;
        if (q === 'boom') throw Object.assign(new Error('x'), { code: 'common.errors.notFound' });
        if (q === 'crash') throw new Error('kaboom');
        return [{ id: 's1', name: 'יואב' }];
      },
    });
    expect(out).toEqual({
      answer: 'מצאתי את יואב.',
      incomplete: false,
      trace: [
        { tool: 'find_students', input: { query: 'יואב' }, output: [{ id: 's1', name: 'יואב' }] },
        {
          tool: 'find_students',
          input: { query: 'boom' },
          output: 'common.errors.notFound',
          error: true,
        },
        {
          tool: 'find_students',
          input: { query: 'crash' },
          output: 'copilot.errors.toolFailed',
          error: true,
        },
      ],
    });
    expect(calls[0]).toMatchObject({
      model: 'claude-opus-5-5',
      thinking: { type: 'adaptive' },
      system: 'sys',
    });
    expect(calls[1]?.messages).toHaveLength(3);
    expect(calls[1]?.messages[2]).toMatchObject({
      role: 'user',
      content: [
        { tool_use_id: 't1', is_error: false },
        { tool_use_id: 't2', is_error: true },
        { is_error: true },
      ],
    });
  });

  it('marks a refusal or a run out of turns as incomplete', async () => {
    const refused = new ClaudeCopilotModel({
      client: scripted([{ stop_reason: 'refusal', content: [] }]).client,
    });
    expect(
      await refused.run({ system: '', prompt: 'x', tools, callTool: async () => null }),
    ).toEqual({
      answer: '',
      trace: [],
      incomplete: true,
    });
    const loop = {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 't', name: 'find_students', input: {} }],
    };
    const looping = new ClaudeCopilotModel({ client: scripted([loop, loop]).client, maxTurns: 2 });
    const out = await looping.run({ system: '', prompt: 'x', tools, callTool: async () => [] });
    expect(out.incomplete).toBe(true);
    expect(out.trace).toHaveLength(2);
    expect(new ClaudeCopilotModel({ apiKey: 'k', model: 'm' }).name).toBe('claude:m');
  });
});
