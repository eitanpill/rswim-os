import { getTranslations } from 'next-intl/server';
import { diverCerts, myDiverId } from '@rswim/domain-dive';
import { withSession } from '@/lib/db';
import { fileStore } from '@/lib/dive-files';
import { requireDivePage } from '../../_ui/access';
import { CertForm, CertList } from '../../_ui/certs';
import { di } from '../../_ui/icons';
import { Empty, Hero, Panel } from '../../_ui/kit';

/** The diver's certification cards: upload a photo of a card, and see which the club has checked. */
export default async function MyCerts() {
  await requireDivePage('me');
  const t = await getTranslations('dive.certs');
  const certs = await withSession(async (tx) => {
    const id = await myDiverId(tx);
    return id ? diverCerts(tx, id) : null;
  });
  if (!certs)
    return (
      <Panel>
        <Empty>{t('noDiver')}</Empty>
      </Panel>
    );
  return (
    <div className="flex flex-col gap-5" data-testid="my-certs">
      <a href="/dive/me/welcome" className="text-sm text-[var(--dive-sea)] hover:underline">
        {t('backWelcome')}
      </a>
      <Hero kicker={t('kicker')} title={t('myTitle')} sub={t('mySub')} />
      <Panel title={t('addTitle')} icon={di.doc}>
        <CertForm uploads={fileStore() !== null} />
      </Panel>
      <Panel title={t('listTitle')} icon={di.shield} flush>
        {certs.length ? <CertList certs={certs} /> : <Empty>{t('none')}</Empty>}
      </Panel>
    </div>
  );
}
