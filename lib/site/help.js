// lib/site/help.js — the help centre's articles (design/WebHelp). Plain
// English, written from how the product actually behaves (docs/USER_JOURNEY.md
// and the Phase 2–3 handoffs), so an answer here is never a promise the app
// does not keep. Search is a client-side match over title and body.
export const CATEGORIES = [
  { key: 'account', title: 'Your account', blurb: 'Signing up, logging in, closing your account' },
  { key: 'show', title: 'Running a show', blurb: 'Booking, cameras, Kit Check, going live' },
  { key: 'money', title: 'Money', blurb: 'Tokens, packs, earnings and payouts' },
  { key: 'safety', title: 'Safety and rules', blurb: 'Blocking, reporting, community guidelines' },
];

export const ARTICLES = [
  { slug: 'mic-stopped', category: 'show', title: 'My mic stopped working mid-show. What do I do?', body: [
    'Open the Fix sheet from the console (the red strip appears by itself when the mic signal drops). Pick the mic again from the list, or switch to the phone’s own mic. The show keeps streaming while you do; viewers see the last good frames and hear you as soon as the new mic sends.',
    'If nothing works, end the show with a press and hold on End show. The recording is kept up to that point, and viewers see the end card rather than a frozen frame.',
  ] },
  { slug: 'second-phone-camera', category: 'show', title: 'How do I turn a second phone into a camera?', body: [
    'On the second phone, open Loudentify and tap "Use this phone as a camera" on the welcome screen. On your main phone, open Kit Check and tap Add camera: a code appears. Scan it with the second phone. It pairs to you, not to the show, so it stays paired for next time.',
    'The camera phone only ever shows its viewfinder, its role, the connection and ON AIR. It cannot see chat or money.',
  ] },
  { slug: 'viewer-hours', category: 'money', title: 'What happens if my viewer-hours run out?', body: [
    'Nothing stops. A show never cuts off mid-performance. If your hours run out while you are live, the show carries on and borrows; the pack offer comes after the show, never during it.',
    'A view counts toward your hours once it passes 30 seconds. Scrolling past you in the feed costs you nothing.',
  ] },
  { slug: 'cash-out', category: 'money', title: 'When can I cash out my earnings?', body: [
    'Once your identity check is done. Earnings show as Pending until the show’s support settles, then Ready. You keep 72.5% of every token sent to you.',
    'Payouts are made by our payment provider to the account you add on the Earnings screen. The timing of the first payout depends on that provider’s checks; we show the date on the screen as soon as we know it.',
  ] },
  { slug: 'book-30-minutes', category: 'show', title: 'Why do I need to book 30 minutes ahead?', body: [
    'A booked show gets a share link, reminders for the people who follow you, a place in What’s on, and a broadcast created ahead of time so going live is one tap. Thirty minutes is the shortest gap that lets all of that happen, and gives you time to run Kit Check properly.',
    'You can start a little early once you are inside the 30-minute window.',
  ] },
  { slug: 'watch-without-account', category: 'account', title: 'Can I watch without an account?', body: [
    'Yes. Open any show and watch. After about a minute we ask you to sign up, which is free and takes one page. You need an account to comment, vote, follow or support an artist, and you must be 18 or over.',
  ] },
  { slug: 'first-show', category: 'show', title: 'Playing your first show: the setup guide', body: [
    'Book a slot at least 30 minutes ahead from Create. Save your mic and camera as a place so the next show loads them for you.',
    'Run Kit Check before every show. It checks the mic is really sending, the camera holds frames for two minutes, the connection is strong enough (we time a real upload), the phone is charging, Do Not Disturb is on, and whether you are on wired headphones. Nothing streams during Kit Check.',
    'When the countdown ends, tap Go live. The console shows the three crops, the chat, prompts and the end button. End the show with a press and hold; the recording and your insights appear on the post-show screen.',
  ] },
  { slug: 'report', category: 'safety', title: 'Report something in a show', body: [
    'Tap the flag on the show screen, pick the reason, and send. The report carries the playback position so we can see exactly what you saw. We look at every report, and we never tell the artist who reported.',
    'For something urgent, use the contact form with "Report a problem" and include the show and the time.',
  ] },
  { slug: 'close-account', category: 'account', title: 'Closing your account', body: [
    'Settings → Account → Close my account. We stop everything straight away and delete your personal data within 30 days, keeping only what the law makes us keep (money records). Recordings of shows you performed in stay with the shows unless you ask for them to be taken down too.',
  ] },
  { slug: 'blocking', category: 'safety', title: 'Hiding and blocking people', body: [
    'Words on a list are hidden from chat before they appear, and every report is reviewed by a person. Blocking another account from your side is not built yet; until it is, report the comment and we act on the account. See the Community Guidelines for what gets people removed.',
  ] },
  { slug: 'get-the-app', category: 'account', title: 'Getting the app', body: [
    'The iPhone and Android apps are built but not in the stores yet. Until they are, everything works in your phone’s browser at loudentify.app, including performing. This page updates the day the listings go live.',
  ] },
];

export const MOST_ASKED = ['mic-stopped', 'second-phone-camera', 'viewer-hours', 'cash-out', 'book-30-minutes', 'watch-without-account'];

export function searchArticles(q) {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return [];
  return ARTICLES.filter((a) => a.title.toLowerCase().includes(t) || a.body.some((p) => p.toLowerCase().includes(t)));
}
