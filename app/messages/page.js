import MessageThread from '../../components/MessageThread';
import PageShell from '../../components/PageShell';

export const metadata = {
  title: 'Messages · Loudentify pilot',
  description: 'Conversation with an artist',
};

export default function MessagesPage() {
  return (
    <PageShell active="profile">
      <MessageThread />
    </PageShell>
  );
}
