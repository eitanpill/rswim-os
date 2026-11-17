import { ImportRunView } from '@/components/imports';
import { requireDivePage } from '../../_ui/access';

export default async function DiveImportRunPage({ params }: { params: Promise<{ id: string }> }) {
  await requireDivePage('import');
  const { id } = await params;
  return <ImportRunView base="/dive/import" id={id} />;
}
