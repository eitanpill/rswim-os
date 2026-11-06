import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { clubForJoin } from '@rswim/domain-dive';
import { ActionForm, CheckboxField, Field, SubmitButton } from '@/components/form';
import { isDevAuthEnabled } from '@/lib/auth/dev';
import { getSession } from '@/lib/auth/session';
import { dbForSlug, withAnon } from '@/lib/db';
import { ClubMark, di } from '../../dive/_ui/icons';
import { Bubbles } from '../../dive/_ui/kit';
import { joinClubAction } from '../actions';

/**
 * A club's join link (from its Instagram, website or WhatsApp): what the club is, then sign in with a phone number,
 * then the diver's details. Joining lands on the diver's first steps: their card, their forms, a first dive.
 */
export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getTranslations('dive.join');
  const club = await withAnon((tx) => clubForJoin(tx, slug), await dbForSlug(slug));
  const session = await getSession();
  if (club && session?.orgId === club.id && session.role === 'parent') redirect('/dive/me/welcome');

  if (!club)
    return (
      <Frame title={t('notFoundTitle')}>
        <p className="text-ink-muted" data-testid="join-not-found">
          {t('notFound')}
        </p>
      </Frame>
    );
  if (session?.orgId === club.id)
    return (
      <Frame club={club.name} title={t('staffTitle')}>
        <p className="text-ink-muted">{t('staff')}</p>
        <a href="/" className="font-medium text-[var(--dive-sea)] hover:underline">
          {t('toApp')}
        </a>
      </Frame>
    );
  if (!club.open)
    return (
      <Frame club={club.name} title={t('closedTitle')}>
        <p className="text-ink-muted" data-testid="join-closed">
          {t('closed')}
        </p>
      </Frame>
    );

  const steps = [t('how.signIn'), t('how.details'), t('how.card'), t('how.forms')];
  if (!session)
    return (
      <Frame club={club.name} title={t('title', { club: club.name })} sub={t('sub')}>
        <ol className="flex flex-col gap-2" data-testid="join-how">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklch,var(--dive-sea)_15%,transparent)] text-sm font-bold text-[var(--dive-sea)]">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
        <a
          href={`/login/phone?join=${slug}`}
          className="inline-flex min-h-tap items-center justify-center rounded-xl bg-[var(--dive-sea)] px-4 font-semibold text-white"
          data-testid="join-sign-in"
        >
          {t('signIn')}
        </a>
        {isDevAuthEnabled() ? (
          <a
            href="/dev/login?as=diveNewcomer"
            className="text-center text-sm text-ink-muted underline-offset-4 hover:underline"
            data-testid="join-demo"
          >
            {t('demo')}
          </a>
        ) : null}
      </Frame>
    );

  return (
    <Frame club={club.name} title={t('title', { club: club.name })} sub={t('formSub')}>
      <ActionForm action={joinClubAction} keepValues testId="join-form">
        <input type="hidden" name="slug" value={slug} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="firstName" label={t('firstName')} autoComplete="given-name" required />
          <Field name="lastName" label={t('lastName')} autoComplete="family-name" required />
        </div>
        <Field
          name="phone"
          label={t('phone')}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          placeholder="050-0000000"
          required
        />
        <Field name="email" label={t('email')} type="email" autoComplete="email" dir="ltr" />
        <Field name="dob" label={t('dob')} type="date" dir="ltr" />
        <fieldset className="flex flex-col gap-3 rounded-xl border border-line p-3">
          <legend className="px-1 text-sm font-semibold">{t('emergency')}</legend>
          <Field name="emergencyName" label={t('emergencyName')} />
          <Field
            name="emergencyPhone"
            label={t('emergencyPhone')}
            type="tel"
            inputMode="tel"
            dir="ltr"
          />
        </fieldset>
        <CheckboxField name="beginner" label={t('beginner')} />
        <CheckboxField name="agree" label={t('agree', { club: club.name })} />
        <SubmitButton data-testid="join-submit">{t('submit')}</SubmitButton>
      </ActionForm>
    </Frame>
  );
}

async function Frame({
  club,
  title,
  sub,
  children,
}: {
  club?: string;
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  const t = await getTranslations('dive.join');
  return (
    <main className="dive min-h-dvh bg-[var(--surface)]" data-surface="dive">
      <section className="bg-ocean relative overflow-hidden text-white">
        <span aria-hidden="true" className="light-rays pointer-events-none absolute inset-0" />
        <Bubbles count={12} />
        <div className="relative mx-auto flex max-w-xl flex-col gap-4 px-5 pt-6 pb-20">
          <div className="flex items-center gap-3">
            <ClubMark size={36} />
            <p className="font-bold" data-testid="join-club">
              {club ?? t('kicker')}
            </p>
          </div>
          <p className="text-xs font-semibold tracking-[0.2em] text-[var(--dive-shallow)]">
            {t('kicker')}
          </p>
          <h1 className="text-3xl leading-tight font-bold tracking-tight">{title}</h1>
          {sub ? <p className="text-white/80">{sub}</p> : null}
        </div>
      </section>
      <div className="relative mx-auto -mt-12 max-w-xl px-4 pb-12">
        <section className="flex flex-col gap-4 rounded-3xl border border-line bg-surface-raised p-5 shadow-sm">
          {children}
        </section>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-ink-muted [&_svg]:size-4">
          {di.shield}
          {t('privacy')}
        </p>
      </div>
    </main>
  );
}
