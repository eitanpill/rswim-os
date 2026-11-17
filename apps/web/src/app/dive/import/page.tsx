import { IMPORT_KINDS_BY_VERTICAL } from '@rswim/contracts';
import { ImportHome } from '@/components/imports';
import { requireDivePage } from '../_ui/access';

/** Bringing divers and the team over from the previous system (Excel, CSV or a Google sheet). */
export default async function DiveImportPage() {
  await requireDivePage('import');
  return <ImportHome base="/dive/import" kinds={IMPORT_KINDS_BY_VERTICAL.freediving} />;
}
