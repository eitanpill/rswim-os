import { PlanView } from './plan-view';

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ feature?: string }>;
}) {
  const { feature } = await searchParams;
  return <PlanView feature={feature} />;
}
