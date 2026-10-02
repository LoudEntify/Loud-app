// /artist/create — Create (Schedule a show, Kit check, New clip). Built in
// Phase 3; this page keeps the tab bar's link honest until then.
import ViewerShell from '../../../components/viewer/ViewerShell';
export const metadata = { title: 'Create · Loudentify' };
export default function CreatePage() {
  return (
    <ViewerShell>
      <div className="v-screen">
        <h1 className="v-h1">Create</h1>
        <div className="v-card-light" style={{ padding: 16 }}>
          <p style={{ fontSize: 17, lineHeight: 1.4 }}>Schedule a show, Kit check and New clip arrive with the artist build (Phase 3). The pilot console still works at <a className="v-link" href="/dashboard">/dashboard</a>.</p>
        </div>
      </div>
    </ViewerShell>
  );
}
