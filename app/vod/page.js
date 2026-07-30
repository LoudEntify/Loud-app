import VODPlayback from '../../components/VODPlayback';

export const metadata = {
  title: 'Replay · Loudentify pilot',
  description: 'Recorded show playback',
};

export default function VODPage() {
  return (
    <main>
      <VODPlayback />
    </main>
  );
}
