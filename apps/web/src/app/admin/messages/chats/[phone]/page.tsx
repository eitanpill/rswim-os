import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@rswim/ui';
import { ChatView } from '@/components/chats/views';
import { MessagesTabs } from '../../tabs';

/** One WhatsApp conversation: the thread, "I'm taking over", and a reply. */
export default async function ChatPage({ params }: { params: Promise<{ phone: string }> }) {
  const { phone } = await params;
  const t = await getTranslations('chats');
  return (
    <>
      <PageHeader icon="💬" title={t('title')} />
      <MessagesTabs active="chats" />
      <ChatView base="/admin/messages/chats" digits={phone} />
    </>
  );
}
