import { PlanView } from '@/app/admin/plan/plan-view';
import { requireDivePage } from '../_ui/access';

/** The club's own Aqua Swim subscription: plan, card, invoices, cancelling (owner only). */
export default async function DivePlanPage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string }>;
}) {
  await requireDivePage('plan');
  const { card } = await searchParams;
  return (
    <div data-testid="dive-plan">
      <PlanView card={card} back="/dive/plan" />
    </div>
  );
}
