import { IMPORT_KINDS_BY_VERTICAL } from '@rswim/contracts';
import { ImportHome } from '@/components/imports';

/** Bringing families and the team over from the previous system (Excel, CSV or a Google sheet). */
export default function ImportPage() {
  return <ImportHome base="/admin/import" kinds={IMPORT_KINDS_BY_VERTICAL.swim} />;
}
