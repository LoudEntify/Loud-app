// /legal/artist-agreement — DRAFT. The agreement artists accept during
// onboarding (Phase 3, step 2), with the training-data clause as a
// separate, off-by-default choice (docs/USER_JOURNEY.md).
import LegalPage from '../../../components/site/LegalPage';

export const metadata = { title: 'Artist agreement (draft) · Loudentify', robots: { index: false } };

const SECTIONS = [
  ['What you agree to', 'The Terms and Conditions and the Community Guidelines apply to you as they do to everyone. This agreement adds what is specific to performing.'],
  ['Your performances',
    'You keep every right in your music and your performance. You give Loudentify a non-exclusive licence to stream your show live, record it, store the recording, show it on Loudentify at the visibility you choose (public, unlisted or private), and deliver it through the services we use, today YouTube on a channel you connect. You can end the licence for future shows by closing your account; recordings already published stay up unless you take them down, which you can do at any time.'],
  ['Training data: your choice',
    'Separately from the licence above, you can let us use your recordings to train and improve the automated production (the camera cuts and the mixing). This is off unless you turn it on. When it is on, a training copy of each show is kept apart from the recording; when you turn it off, no new copies are made and you can ask for existing copies to be deleted. Turning it off never affects your shows, your earnings or your place in the feed.'],
  ['Money',
    'You receive 72.5% of every token fans send you, shown in pounds on your Earnings screen. Payouts go through our payment provider after an identity check. You are responsible for any tax on what you earn.'],
  ['Your YouTube connection',
    'Connecting a YouTube channel lets us create and manage live broadcasts on it for your shows. We store the connection’s tokens encrypted and use them only for that. Disconnecting removes them. YouTube’s own terms apply to your channel.'],
  ['Ending this agreement', 'You can stop performing at any time. We can end this agreement for breaches of the Terms or Guidelines, and we will tell you why.'],
];

export default function ArtistAgreement() {
  return <LegalPage path="/legal/artist-agreement" title="Artist agreement" applies="Applies to anyone who performs on Loudentify" sections={SECTIONS}
    summary="You keep your rights. You let us stream, record and show your performances. Using your recordings to train the automated production is a separate choice, off by default. You get 72.5% of what fans send you." />;
}
