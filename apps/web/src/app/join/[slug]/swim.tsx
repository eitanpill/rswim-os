import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { myJoinRequests, type PublicSchool } from '@rswim/domain-platform';
import { Button } from '@rswim/ui';
import { ActionForm, Field, SubmitButton, TextareaField } from '@/components/form';
import { isDevAuthEnabled } from '@/lib/auth/dev';
import type { Session } from '@/lib/auth/types';
import { dbForSlug, withSignedIn } from '@/lib/db';
import { switchSchoolAction } from '../../me/schools/actions';
import { requestToJoinAction } from '../actions';

/** Rows for children on the form (the database takes up to four; a bigger family talks to the office). */
const CHILD_ROWS = [1, 2, 3] as const;

/**
 * A swim school's page in the app (its link, its QR, or the school search): what the school is, then sign in with a
 * phone number, then ask to join (or for a trial lesson). The office decides; the request's state shows here.
 */
export async function SwimJoin({
  slug,
  school,
  session,
}: {
  slug: string;
  school: PublicSchool;
  session: Session | null;
}) {
  const t = await getTranslations('schools.join');

  if (session?.orgId === school.id)
    return (
      <Frame school={school} title={t('memberTitle')}>
        <p className="text-ink-muted">{t('member')}</p>
        <Link href="/" className="font-medium text-brand-600 hover:underline">
          {t('toApp')}
        </Link>
      </Frame>
    );

  if (!session)
    return (
      <Frame school={school} title={t('title', { school: school.name })} sub={t('sub')}>
        <ol className="flex flex-col gap-2" data-testid="join-how">
          {[t('how.signIn'), t('how.details'), t('how.office')].map((s, i) => (
            <li key={s} className="flex items-center gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-700 dark:bg-surface">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
        <a
          href={`/login/phone?join=${slug}`}
          className="inline-flex min-h-tap items-center justify-center rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700"
          data-testid="join-sign-in"
        >
          {t('signIn')}
        </a>
        {isDevAuthEnabled() ? (
          <a
            href="/dev/login?as=familyNewcomer"
            className="text-center text-sm text-ink-muted underline-offset-4 hover:underline"
            data-testid="join-demo"
          >
            {t('demo')}
          </a>
        ) : null}
      </Frame>
    );

  const mine = (
    await withSignedIn((tx) => myJoinRequests(tx), { database: await dbForSlug(slug) })
  ).find((r) => r.orgId === school.id && r.status !== 'withdrawn');

  if (mine?.status === 'accepted')
    return (
      <Frame school={school} title={t('acceptedTitle')}>
        <p className="text-ink-muted">{t('accepted', { school: school.name })}</p>
        <form action={switchSchoolAction}>
          <input type="hidden" name="orgId" value={school.id} />
          <Button type="submit" data-testid="enter-school">
            {t('enter')}
          </Button>
        </form>
      </Frame>
    );

  const sent = mine?.status === 'new';
  return (
    <Frame
      school={school}
      title={sent ? t('sentTitle') : t('title', { school: school.name })}
      sub={sent ? t('sent') : t('formSub')}
    >
      {mine?.status === 'declined' ? (
        <p className="rounded-xl bg-warn/20 px-3 py-2 text-sm" data-testid="join-declined">
          {t('declined')}
        </p>
      ) : null}
      {sent ? (
        <p className="text-sm text-ink-muted" data-testid="join-sent">
          {t('sentEdit')}
        </p>
      ) : null}
      <ActionForm action={requestToJoinAction} keepValues testId="join-request">
        <input type="hidden" name="slug" value={slug} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">{t('kind')}</legend>
          {(['join', 'trial'] as const).map((k) => (
            <label
              key={k}
              className="flex min-h-tap items-center gap-2 rounded-xl border border-line px-3"
            >
              <input type="radio" name="kind" value={k} defaultChecked={k === 'trial'} />
              {t(`kinds.${k}`)}
            </label>
          ))}
        </fieldset>
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
        <fieldset className="flex flex-col gap-3 rounded-xl border border-line p-3">
          <legend className="px-1 text-sm font-semibold">{t('children')}</legend>
          <p className="text-sm text-ink-muted">{t('childrenHint')}</p>
          {CHILD_ROWS.map((i) => (
            <div key={i} className="grid gap-3 sm:grid-cols-2">
              <Field name={`child${i}Name`} label={t('childName', { n: i })} />
              <Field name={`child${i}Dob`} label={t('childDob')} type="date" dir="ltr" />
            </div>
          ))}
        </fieldset>
        <TextareaField name="note" label={t('note')} hint={t('noteHint')} maxLength={500} />
        <SubmitButton data-testid="join-submit">{sent ? t('update') : t('submit')}</SubmitButton>
      </ActionForm>
    </Frame>
  );
}

async function Frame({
  school,
  title,
  sub,
  children,
}: {
  school: PublicSchool;
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  const t = await getTranslations('schools.join');
  return (
    <main className="min-h-dvh bg-surface" data-surface="join">
      <section className="bg-brand-600 text-white">
        <div className="mx-auto flex max-w-xl flex-col gap-3 px-5 pt-6 pb-20">
          <div className="flex items-center justify-between gap-3">
            <p className="font-bold" data-testid="join-school">
              {school.name}
            </p>
            <Link href="/schools" className="text-sm text-white/80 hover:underline">
              {t('otherSchools')}
            </Link>
          </div>
          {school.city ? <p className="text-sm text-white/80">{school.city}</p> : null}
          <h1 className="text-3xl leading-tight font-bold tracking-tight">{title}</h1>
          {sub ? <p className="text-white/85">{sub}</p> : null}
          {school.about ? <p className="text-sm text-white/80">{school.about}</p> : null}
        </div>
      </section>
      <div className="relative mx-auto -mt-12 max-w-xl px-4 pb-12">
        <section className="flex flex-col gap-4 rounded-3xl border border-line bg-surface-raised p-5 shadow-sm">
          {children}
        </section>
        <p className="mt-4 text-center text-xs text-ink-muted">{t('privacy')}</p>
      </div>
    </main>
  );
}
