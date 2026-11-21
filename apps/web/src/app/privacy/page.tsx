import type { Metadata } from 'next';
import { PRODUCT } from '@rswim/contracts';
import { EN, HE, type Policy } from './content';

export const metadata: Metadata = {
  title: `Privacy policy · מדיניות פרטיות · ${PRODUCT.name}`,
};

/** Public, no sign-in: the URL Meta (WhatsApp) and the app stores link to. Hebrew first, English below. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-10 px-4 py-10" data-testid="privacy">
      <nav className="flex justify-center gap-4 text-sm">
        <a href="#he" className="font-medium text-brand-600 hover:underline">
          עברית
        </a>
        <a href="#en" className="font-medium text-brand-600 hover:underline">
          English
        </a>
      </nav>
      <PolicyView policy={HE} />
      <hr className="border-line" />
      <PolicyView policy={EN} />
    </main>
  );
}

function PolicyView({ policy }: { policy: Policy }) {
  return (
    <article id={policy.lang} lang={policy.lang} dir={policy.dir} className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{policy.title}</h1>
        <p className="text-sm text-ink-muted">{policy.updated}</p>
      </header>
      {policy.intro.map((p) => (
        <p key={p} className="leading-relaxed">
          {p}
        </p>
      ))}
      {policy.sections.map((s) => (
        <section key={s.title} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{s.title}</h2>
          {s.paragraphs?.map((p) => (
            <p key={p} className="leading-relaxed">
              {p}
            </p>
          ))}
          {s.items ? (
            <ul className="flex list-disc flex-col gap-1 ps-5 leading-relaxed">
              {s.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </article>
  );
}
