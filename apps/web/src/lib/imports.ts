import 'server-only';
import { IMPORT_FIELDS, type ImportKind, type ImportMapping } from '@rswim/contracts';
import { guessMapping, mergeSuggestion, type Table } from '@rswim/domain-imports';
import { ClaudeColumnSuggester, type ColumnSuggester } from '@rswim/integrations';

/** Claude for the columns the header rules could not place, with ANTHROPIC_API_KEY; otherwise the rules alone. */
export function columnSuggester(): ColumnSuggester | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new ClaudeColumnSuggester({ apiKey }) : null;
}

/**
 * The rules' guess at each column, with Claude's suggestion for the columns left empty. Claude sees each such column's
 * header and two sample values with their digits masked. A failure there only means the owner maps those by hand.
 */
export async function suggestMapping(kind: ImportKind, table: Table): Promise<ImportMapping> {
  const base = guessMapping(kind, table.headers);
  const suggester = columnSuggester();
  const open = table.headers
    .map((header, index) => ({
      index,
      header,
      samples: table.rows
        .map((r) => r[index] ?? '')
        .filter(Boolean)
        .slice(0, 2),
    }))
    .filter((c) => !base[String(c.index)] && c.samples.length > 0);
  if (!suggester || open.length === 0) return base;
  try {
    const suggestion = await suggester.suggest({ kind, fields: IMPORT_FIELDS[kind], columns: open });
    return mergeSuggestion(kind, base, suggestion);
  } catch {
    // Claude unreachable or refusing: the owner maps those columns by hand on the next screen.
    return base;
  }
}
