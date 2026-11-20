import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@rswim/ui';
import { chatFilter, ChatsList } from '@/components/chats/views';
import { MessagesTabs } from '../tabs';

/** Every WhatsApp conversation in one place (WhatsApp track W9), with how the bot is doing. */
export default async function ChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { show } = await searchParams;
  const t = await getTranslations('chats');
  return (
    <>
      <PageHeader icon="💬" title={t('title')} subtitle={t('subtitle')} />
      <MessagesTabs active="chats" />
      <ChatsList base="/admin/messages/chats" filter={chatFilter(show)} />
    </>
  );
}
