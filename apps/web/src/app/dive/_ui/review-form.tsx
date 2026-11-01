import { getTranslations } from 'next-intl/server';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { reviewAction } from '../forms-actions';

/** The office clears a health declaration (with a doctor's note) or refuses it. */
export async function ReviewForm({
  signatureId,
  uploads,
}: {
  signatureId: string;
  uploads: boolean;
}) {
  const t = await getTranslations('dive.forms');
  return (
    <ActionForm action={reviewAction} testId={`review-${signatureId}`}>
      <input type="hidden" name="signatureId" value={signatureId} />
      <Field name="note" label={t('reviewNote')} placeholder={t('reviewNotePlaceholder')} />
      {uploads ? (
        <Field
          name="document"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          label={t('uploadDoctor')}
          className="py-2 text-sm"
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="cleared" data-testid="review-clear">
          {t('clearIt')}
        </SubmitButton>
        <SubmitButton
          name="decision"
          value="refused"
          variant="secondary"
          data-testid="review-refuse"
        >
          {t('refuseIt')}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
