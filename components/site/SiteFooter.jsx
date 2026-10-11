// components/site/SiteFooter.jsx — the site footer (design/WebHome.dc.html),
// shared by SiteShell and the landing page. No 'use client': it has no
// state, so a page can render it without pulling in SiteShell's session code.
// The social labels start with the visible text so the accessible name
// matches what is shown (WCAG 2.5.3).
// `surface` names the background it sits on, as components/Logo.jsx does.
export default function SiteFooter({ surface = 'light' }) {
  return (
    <footer className="w-footer">
      <div className="w-wrap w-footer-grid">
        <div className="w-footer-brand">
          <img src={surface === 'dark' ? '/logo/loudentify-on-dark.png' : '/logo/loudentify-on-light.png'} alt="Loudentify" />
          <span>Live music, directed for you.</span>
          {/* Social links: the handles are Korey's to confirm (docs/NEEDS_KOREY.md). Until then they go to the contact page. */}
          <div className="w-social" aria-label="Social">
            <a href="/contact" aria-label="IG: Instagram (not yet linked)">IG</a>
            <a href="/contact" aria-label="TT: TikTok (not yet linked)">TT</a>
            <a href="/contact" aria-label="X (not yet linked)">X</a>
            <a href="/contact" aria-label="YT: YouTube (not yet linked)">YT</a>
          </div>
        </div>
        <div className="w-footer-col"><strong>Product</strong><a href="/artists">For artists</a><a href="/fans">For fans</a><a href="/pricing">Pricing</a><a href="/get-app">Get the app</a></div>
        <div className="w-footer-col"><strong>Company</strong><a href="/about">About</a><a href="/contact">Contact</a><a href="/help">Help</a></div>
        <div className="w-footer-col"><strong>Legal</strong><a href="/legal/terms">Terms and Conditions</a><a href="/legal/community-guidelines">Community Guidelines</a><a href="/privacy">Privacy</a><a href="/legal/cookies">Cookies</a></div>
      </div>
    </footer>
  );
}

