import { requireDivePage } from '@/app/dive/_ui/access';
import { ChatView } from '@/components/chats/views';

/** One of the club's WhatsApp conversations: the thread, "I'm taking over", and a reply. */
export default async function DiveChatPage({ params }: { params: Promise<{ phone: string }> }) {
  await requireDivePage('chats');
  const { phone } = await params;
  return <ChatView base="/dive/chats" digits={phone} />;
}
