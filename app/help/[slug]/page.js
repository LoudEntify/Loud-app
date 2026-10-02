import { notFound } from 'next/navigation';
import SiteShell from '../../../components/site/SiteShell';
import { ARTICLES, CATEGORIES } from '../../../lib/site/help';

export function generateStaticParams() { return ARTICLES.map((a) => ({ slug: a.slug })); }
export function generateMetadata({ params }) { const a = ARTICLES.find((x) => x.slug === params.slug); return { title: a ? `${a.title} · Help · Loudentify` : 'Help · Loudentify' }; }

export default function HelpArticle({ params }) {
  const a = ARTICLES.find((x) => x.slug === params.slug);
  if (!a) notFound();
  const cat = CATEGORIES.find((c) => c.key === a.category);
  return (
    <SiteShell cta={null}>
      <div className="w-section" style={{ display: 'flex', flexDirection: 'column', gap: 20 }} data-testid="help-article">
        <a href="/help" className="w-link" style={{ alignSelf: 'flex-start' }}>&larr; Help centre{cat ? ` · ${cat.title}` : ''}</a>
        <h1 className="w-h1" style={{ fontSize: 44, maxWidth: 800 }}>{a.title}</h1>
        <div className="w-prose">{a.body.map((p, i) => <p key={i}>{p}</p>)}</div>
        <div className="w-card" style={{ maxWidth: 760, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}><span style={{ fontSize: 17 }}>Did this answer it? If not, tell us what you were trying to do.</span><a href={`/contact?topic=${a.category === 'money' ? 'payments' : a.category === 'safety' ? 'report' : a.category === 'show' ? 'artist_support' : 'general'}`} className="w-pill w-pill-outline">Contact us</a></div>
      </div>
    </SiteShell>
  );
}
