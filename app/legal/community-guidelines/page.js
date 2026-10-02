// /legal/community-guidelines — DRAFT (design/WebLegal template).
import LegalPage from '../../../components/site/LegalPage';

export const metadata = { title: 'Community Guidelines (draft) · Loudentify', robots: { index: false } };

const SECTIONS = [
  ['What Loudentify is for', 'Live music, played by real people to people who chose to be there. Everything below follows from that.'],
  ['In chat and comments',
    ['No abuse, threats or harassment of artists or other viewers.', 'No hate speech about who someone is.', 'No sexual content, and nothing sexual about anyone under 18, ever.', 'No spam, scams, links to steal logins, or selling things.', 'No sharing anyone’s private details.'],
    'We hide words on a list before they appear, and we review every report.'],
  ['On stage',
    ['Perform what you have the right to perform.', 'No nudity or sexual performance.', 'No violence, weapons, or dangerous stunts.', 'No pretending to be someone else, including another artist.', 'In Versus, hand over the stage when it is the other artist’s turn.']],
  ['Votes and support',
    'One vote each. Buying votes, trading votes, or using more than one account to vote gets every account involved removed. Tokens never change a result and never will.'],
  ['Reporting',
    'Tap the flag on any show, pick the reason, and send. The report carries the moment you saw. We never tell the artist who reported. For an emergency, contact the police first.'],
  ['What happens when rules are broken',
    'A first problem usually gets a warning and the content removed. Repeated or serious problems close the account. Anything illegal is reported to the authorities. You can appeal any decision through the contact page.'],
];

export default function Guidelines() {
  return <LegalPage path="/legal/community-guidelines" title="Community Guidelines" applies="Applies to everyone in a show" sections={SECTIONS}
    summary="Be decent to the people on stage and in the chat. Perform what you have the right to perform. One vote each, and money never buys a result. Report what you see; we look at everything." />;
}
