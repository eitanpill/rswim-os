import { getTranslations } from 'next-intl/server';
import { requireDivePage } from '@/app/dive/_ui/access';
import { Hero } from '@/app/dive/_ui/kit';
import { chatFilter, ChatsList } from '@/components/chats/views';

/** The club's WhatsApp conversations in one place (WhatsApp track W9), with how the bot is doing. */
export default async function DiveChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  await requireDivePage('chats');
  const { show } = await searchParams;
  const t = await getTranslations('chats');
  return (
    <div className="flex flex-col gap-2">
      <Hero kicker={t('subtitle')} title={t('title')} />
      <ChatsList base="/dive/chats" filter={chatFilter(show)} />
    </div>
  );
}
