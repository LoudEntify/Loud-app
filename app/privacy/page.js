import Logo from '../../components/Logo';

// app/privacy/page.js
// ─────────────────────────────────────────────────────────────
// Public, static, no login. Needed for Google OAuth verification
// (Google's reviewers load this with no session), so it must never
// depend on Supabase, an API route, or anything else that can 401 or
// 500 for a signed-out caller. Plain Server Component: no 'use client',
// no hooks, no fetch, no cookies, no analytics, no third-party script
// tags. next/font self-hosts PT Sans Narrow at build time (inherited
// from the shared root layout's --font-app variable), so there is no
// runtime request to Google Fonts either.
//
// lang="en-GB" was asked for in the design spec but the single shared
// <html> tag lives in app/layout.js and already says "en" for the whole
// app — see docs/DECISIONS.md for why that wasn't changed just for this
// page.

const INK = '#011627';
const PORCELAIN = '#fdfffc';
const TEAL = '#2ec4b6';

export const metadata = {
  title: 'Privacy policy · Loudentify',
  description:
    'How Loudentify collects, uses and protects your information, including our use of YouTube API Services.',
  robots: { index: true, follow: true },
};

const bodyFont = 'var(--font-app), "Arial Narrow", Arial, sans-serif';

// 70ish characters per line at this font/size lands around 640px.
const CONTENT_WIDTH = 640;

function H2({ children }) {
  return (
    <h2
      style={{
        fontFamily: bodyFont,
        fontSize: 22,
        fontWeight: 700,
        color: INK,
        margin: '2em 0 0.6em',
      }}
    >
      {children}
    </h2>
  );
}

function P({ children }) {
  return (
    <p style={{ fontFamily: bodyFont, fontSize: 17, lineHeight: 1.6, color: INK, margin: '0 0 1em' }}>{children}</p>
  );
}

function Ul({ children }) {
  return (
    <ul style={{ fontFamily: bodyFont, fontSize: 17, lineHeight: 1.6, color: INK, margin: '0 0 1em', paddingLeft: '1.2em' }}>
      {children}
    </ul>
  );
}

// Links on the porcelain body: ink black, underlined, never teal (teal
// text is reserved for the ink-black header/footer). Underline plus
// generous line-height keeps the tap target close to 44px without
// needing a box around plain inline text.
function A({ href, children }) {
  return (
    <a href={href} style={{ color: INK, textDecoration: 'underline', fontWeight: 700 }}>
      {children}
    </a>
  );
}

export default function PrivacyPage() {
  return (
    <div style={{ background: PORCELAIN, minHeight: '100vh' }}>
      {/* Header band: ink black, the existing mark, nothing else. */}
      <header style={{ background: INK, padding: '20px 24px' }}>
        <div style={{ maxWidth: CONTENT_WIDTH, margin: '0 auto' }}>
          <Logo surface="dark" height={36} />
        </div>
      </header>

      <main style={{ maxWidth: CONTENT_WIDTH, margin: '0 auto', padding: '40px 24px 24px' }}>
        <h1 style={{ fontFamily: bodyFont, fontSize: 32, fontWeight: 700, color: INK, margin: '0 0 12px' }}>
          Privacy policy
        </h1>
        {/* The thin teal bar: a fill/accent, never text, per the brand rule. */}
        <div style={{ width: 64, height: 4, background: TEAL, margin: '0 0 16px' }} />
        <P>
          <strong>Last updated: 1 October 2026</strong>
        </P>

        <P>
          This page explains what Loudentify does with your information. We keep it short and plain. Loudentify is
          a place where independent artists perform live and fans watch, chat and vote. It is for adults only (18
          and over).
        </P>

        <H2>Who we are</H2>
        <P>
          Loudentify is currently run by Oluwakorede Alashe. A UK company is being set up, and this page will be
          updated when it is. We are responsible for your personal data. You can reach us at{' '}
          <A href="mailto:build@loudentify.app">build@loudentify.app</A>.
        </P>

        <H2>What we collect</H2>
        <Ul>
          <li>
            Account details: your name, username or stage name, email address, date of birth, and country and city.
            We use your date of birth only to check you are 18 or over. If you are under 18 we do not keep it.
          </li>
          <li>Your activity: shows you watch, comments, votes, follows, reminders, messages and tokens you spend.</li>
          <li>Performer content: the video and audio of shows you perform, recordings and clips.</li>
          <li>
            Payments: our payment provider handles your card. We never see or store card numbers. We keep a record
            of token purchases and payouts.
          </li>
          <li>
            Identity checks for artists before a payout: our identity provider does the check. We keep only a pass
            or fail and a reference.
          </li>
          <li>
            Technical information: your device, browser and IP address, in logs we use to keep Loudentify secure and
            working.
          </li>
        </Ul>

        <H2>Why we use it</H2>
        <Ul>
          <li>To run Loudentify for you (to carry out our contract with you).</li>
          <li>To keep people safe, stop fraud and meet legal duties.</li>
          <li>To understand how the product is used, using pseudonymous analytics that do not include your name or email.</li>
          <li>
            To improve our AI camera director using a performer&rsquo;s own footage, only inside Loudentify.
            Performers can switch this off at any time in Settings, and it is never used for viewers.
          </li>
          <li>To send marketing email only if you say yes. You can withdraw at any time.</li>
        </Ul>

        <H2>Loudentify and YouTube</H2>
        <P>
          Loudentify uses YouTube API Services. Artists can connect their YouTube channel so their live show goes
          out on their own channel. Fans watch through an embedded YouTube player.
        </P>
        <Ul>
          <li>
            What we access: when an artist connects, we ask Google for permission to create and end live broadcasts
            on their channel and to read the basic channel details we need to do that. We do not read your private
            videos, watch history, subscriptions or anything else unrelated to going live.
          </li>
          <li>How we use it: only to create, start and end your live show on your channel and to show it inside Loudentify.</li>
          <li>How we protect it: connection tokens are encrypted and are not shown to anyone, including our staff.</li>
          <li>
            What we do not do: we do not sell this information, use it for advertising, or share it, except with
            service providers who help us run Loudentify under contract.
          </li>
          <li>
            Stopping: you can disconnect YouTube in Loudentify Settings at any time and we delete the tokens. You can
            also remove Loudentify&rsquo;s access in your Google account at{' '}
            <A href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</A>. Content already
            on your YouTube channel stays there until you remove it.
          </li>
          <li>
            For viewers: the YouTube player may set cookies and collect data under Google&rsquo;s policy. Where the
            law requires, we ask for your consent before it loads. We do not receive your YouTube identity.
          </li>
        </Ul>
        <P>
          Loudentify&rsquo;s use and transfer to any other app of information received from Google APIs will adhere
          to the Google API Services User Data Policy, including the Limited Use requirements. By using
          Loudentify&rsquo;s YouTube features you also agree to the{' '}
          <A href="https://www.youtube.com/t/terms">YouTube Terms of Service</A>. Google&rsquo;s privacy policy is at{' '}
          <A href="https://policies.google.com/privacy">policies.google.com/privacy</A>.
        </P>

        <H2>Who we share it with</H2>
        <P>
          Service providers that host our systems and database, carry live video, process payments, run identity
          checks and send email, all under contract, and YouTube (Google) as described above. We do not sell
          personal data. We share information with authorities only when the law requires it.
        </P>

        <H2>How long we keep it</H2>
        <P>
          Your account details for as long as your account exists. Recordings until the artist deletes them, unless
          a show has been reported, in which case we may freeze it while we look into it. Payment and payout records
          for six years. Pseudonymous analytics for 13 months.
        </P>

        <H2>Where it is held</H2>
        <P>
          We keep the personal data we hold in the UK or EU. Live shows carried on YouTube are public and held by
          Google, who may process data in other countries.
        </P>

        <H2>Your rights</H2>
        <P>
          You can ask to see, correct or delete your data, to limit or object to how we use it, to take it with you,
          and to withdraw consent. In Settings you can download your data and close your account. If you are
          unhappy, you can complain to the Information Commissioner&rsquo;s Office at{' '}
          <A href="https://ico.org.uk">ico.org.uk</A>. Email{' '}
          <A href="mailto:build@loudentify.app">build@loudentify.app</A> and we will answer within one month.
        </P>

        <H2>Cookies</H2>
        <P>
          We use only the cookies the service needs. Analytics, marketing and the YouTube player&rsquo;s cookies
          load only after you say yes, where the law requires it.
        </P>

        <H2>Children</H2>
        <P>Loudentify is for people aged 18 and over.</P>

        <H2>Changes</H2>
        <P>If we change this page we will update the date above and tell you about important changes.</P>
      </main>

      {/* No sitewide footer exists anywhere in the app (checked
          components/ and app/) -- per the task's own fallback, this
          small footer is scoped to this page only. */}
      <footer style={{ background: INK, padding: '24px', marginTop: 24 }}>
        <div
          style={{
            maxWidth: CONTENT_WIDTH,
            margin: '0 auto',
            fontFamily: bodyFont,
            fontSize: 14,
            color: PORCELAIN,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            alignItems: 'center',
          }}
        >
          <span>&copy; 2026 Loudentify</span>
          <a
            href="mailto:build@loudentify.app"
            style={{ color: TEAL, textDecoration: 'underline', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
          >
            build@loudentify.app
          </a>
        </div>
      </footer>
    </div>
  );
}
