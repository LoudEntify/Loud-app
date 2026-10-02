// /contact — design/WebContact.dc.html.
import SiteShell from '../../components/site/SiteShell';
import ContactForm from '../../components/site/ContactForm';
import { Question, Doc, Shield, Chevron } from '../../components/site/SiteIcons';

export const metadata = { title: 'Contact · Loudentify', description: 'Tell us what you need and we will come back to you.' };
const EMAILS = { general: process.env.NEXT_PUBLIC_CONTACT_EMAIL_GENERAL || '', press: process.env.NEXT_PUBLIC_CONTACT_EMAIL_PRESS || '', artists: process.env.NEXT_PUBLIC_CONTACT_EMAIL_ARTISTS || '' };

export default function Contact({ searchParams }) {
  const Row = ({ href, Icon, label }) => <a href={href} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid rgba(253,255,252,.15)', fontSize: 18 }}><Icon size={22} /><span style={{ flex: 1 }}>{label}</span><Chevron size={20} /></a>;
  const Mail = ({ label, value }) => <span style={{ fontSize: 17 }}>{label}: {value ? <a href={`mailto:${value}`} className="w-link">{value}</a> : <span style={{ opacity: .6 }}>address to be confirmed</span>}</span>;
  return (
    <SiteShell cta={null}>
      <div className="w-cols" style={{ paddingTop: 24 }}>
        <div className="w-main">
          <h1 className="w-h1" style={{ fontSize: 52 }}>Contact us</h1>
          <p className="w-lead">Tell us what you need and we will come back to you.</p>
          <ContactForm initialTopic={searchParams?.topic || 'general'} />
        </div>
        <aside className="w-aside">
          <div className="w-dark" style={{ padding: 24 }}>
            <h2 className="w-h3" style={{ fontSize: 22, marginBottom: 8 }}>Quicker ways</h2>
            <Row href="/help" Icon={Question} label="Help centre" />
            <Row href="/help/first-show" Icon={Doc} label="Artist setup guides" />
            <Row href="/help/report" Icon={Shield} label="Report something in a show" />
          </div>
          <div className="w-card"><h2 className="w-h3" style={{ fontSize: 22 }}>Email us</h2><Mail label="General" value={EMAILS.general} /><Mail label="Press" value={EMAILS.press} /><Mail label="Artists" value={EMAILS.artists} /></div>
          <div className="w-card"><h2 className="w-h3" style={{ fontSize: 22 }}>Follow along</h2><div className="w-social">{['IG', 'TT', 'X', 'YT'].map((n) => <a key={n} href="/contact" aria-label={`${n} (not yet linked)`} style={{ width: 44, height: 44 }}>{n}</a>)}</div></div>
        </aside>
      </div>
    </SiteShell>
  );
}
