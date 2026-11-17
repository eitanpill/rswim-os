import { PlanView } from './plan-view';

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ feature?: string; card?: string }>;
}) {
  const { feature, card } = await searchParams;
  return <PlanView feature={feature} card={card} />;
}
