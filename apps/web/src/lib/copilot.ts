import 'server-only';
import { FakeCopilotModel } from '@rswim/domain-copilot';
import { ClaudeCopilotModel, type CopilotModel } from '@rswim/integrations';

/**
 * The copilot's model: the rules-based stand-in with RSWIM_COPILOT_FAKE=1 (demos, tests), Claude with
 * ANTHROPIC_API_KEY, otherwise none (the screen says so).
 */
export function copilotModel(today: string): CopilotModel | null {
  if (process.env.RSWIM_COPILOT_FAKE === '1') return new FakeCopilotModel(today);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new ClaudeCopilotModel({ apiKey }) : null;
}
