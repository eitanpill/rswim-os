import { ImportRunView } from '@/components/imports';

export default async function ImportRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ImportRunView base="/admin/import" id={id} />;
}
