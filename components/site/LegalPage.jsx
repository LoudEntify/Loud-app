// The legal template (design/WebLegal.dc.html): side nav, title, meta
// line, summary card, numbered sections. Every document here is a DRAFT
// until Korey's lawyer has been through it, and the page says so at the
// top in words and a badge, not in a footnote.
import SiteShell from './SiteShell';

export const LEGAL_DOCS = [
  ['/legal/terms', 'Terms and Conditions'],
  ['/legal/community-guidelines', 'Community Guidelines'],
  ['/privacy', 'Privacy notice'],
  ['/legal/cookies', 'Cookies'],
  ['/legal/artist-agreement', 'Artist agreement'],
];

export default function LegalPage({ path, title, applies, updated = '2 October 2026', draft = true, summary, sections, children }) {
  return (
    <SiteShell cta={null}>
      <div className="w-cols" style={{ paddingTop: 24 }}>
        <nav className="w-legal-nav" aria-label="Legal documents">
          {LEGAL_DOCS.map(([href, label]) => <a key={href} href={href} aria-current={href === path ? 'page' : undefined}>{label}</a>)}
        </nav>
        <article className="w-main" data-testid="legal-page" data-draft={draft}>
          {draft && <div className="w-error" role="note" style={{ background: 'rgba(255,159,28,.18)' }} data-testid="draft-notice"><strong><span className="w-badge w-badge-draft">DRAFT</span>&nbsp; This document is a draft.</strong><span>It has not been reviewed by a lawyer and is not yet in force. It is published so the wording can be checked, not as terms anyone has agreed to.</span></div>}
          <h1 className="w-h1" style={{ fontSize: 48 }}>{title}</h1>
          <span className="w-note">Last updated {updated} · {applies}</span>
          {summary && <div className="w-summary"><h2 className="w-h3" style={{ fontSize: 22 }}>The short version</h2><p style={{ fontSize: 17, lineHeight: 1.5 }}>{summary}</p></div>}
          <div className="w-prose">
            {sections?.map(([h, ...ps], i) => <section key={h}><h2>{i + 1}. {h}</h2>{ps.map((p, j) => Array.isArray(p) ? <ul key={j}>{p.map((li) => <li key={li}>{li}</li>)}</ul> : <p key={j}>{p}</p>)}</section>)}
            {children}
          </div>
        </article>
      </div>
    </SiteShell>
  );
}
