// /artist/create — Create (Create.dc.html): Schedule a show, Kit check, New clip.
import ViewerShell from '../../../components/viewer/ViewerShell';
export const metadata = { title: 'Create · Loudentify' };
const rows = [
  ['/artist/schedule', 'Schedule a show', 'Book a slot at least 30 minutes ahead'],
  ['/artist/kit-check', 'Kit check', 'Check your mic and cameras. Nothing streams.'],
  ['/artist/clips/new', 'New clip', 'Trim up to 90 seconds from a past show'],
];
export default function CreatePage() {
  return (
    <ViewerShell>
      <div className="v-screen">
        <div className="v-row" style={{ justifyContent: 'space-between' }}><h1 className="v-h1" style={{ fontSize: 30 }}>Create</h1><a href="/profile" className="v-link">Close</a></div>
        <div className="v-card-light">{rows.map(([h, t, s]) => <a key={h} href={h} className="v-list-row" style={{ minHeight: 72 }}><span className="v-col" style={{ flex: 1, gap: 2 }}><span style={{ fontSize: 19, fontWeight: 700 }}>{t}</span><span className="v-muted" style={{ fontSize: 14 }}>{s}</span></span></a>)}</div>
      </div>
    </ViewerShell>
  );
}
