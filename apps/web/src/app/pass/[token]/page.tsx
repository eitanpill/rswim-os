import { getTranslations } from 'next-intl/server';
import { Badge, Card } from '@rswim/ui';
import { dmy, todayIL } from '@/lib/options';
import { verifyPass } from '@/lib/pass';
import { passMasterKey } from '@/lib/pass-server';

/**
 * What the pool entrance sees after scanning a companion pass: valid today or not, and what it allows. Public and
 * stateless: the signature is the proof, so no login and no database.
 */
export default async function PassCheckPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('pass');
  const tp = await getTranslations('parent.pass');
  const key = passMasterKey();
  const check = key ? verifyPass(token, key, todayIL()) : null;
  const data = check?.data ?? null;
  const verdict = !check
    ? t('forged')
    : check.valid
      ? t('valid')
      : check.reason === 'forged'
        ? t('forged')
        : t(check.reason, { date: dmy(check.data?.d) });

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-10">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <Card data-testid="pass-check">
        <Badge tone={check?.valid ? 'ok' : 'danger'} className="text-lg">
          {verdict}
        </Badge>
        {data ? (
          <dl className="mt-3 grid grid-cols-2 gap-2 text-base">
            <dt className="text-ink-muted">{t('school')}</dt>
            <dd>{data.s}</dd>
            <dt className="text-ink-muted">{t('child')}</dt>
            <dd className="font-semibold">{data.c}</dd>
            <dt className="text-ink-muted">{t('group')}</dt>
            <dd>{data.g}</dd>
            <dt className="text-ink-muted">{t('venue')}</dt>
            <dd>{data.v}</dd>
            <dt className="text-ink-muted">{t('time')}</dt>
            <dd>
              {dmy(data.d)} {data.t}
            </dd>
            <dt className="text-ink-muted">{t('companions')}</dt>
            <dd className="font-semibold">{tp('companions', { n: data.n })}</dd>
          </dl>
        ) : null}
      </Card>
    </main>
  );
}
