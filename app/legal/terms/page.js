// /legal/terms — DRAFT Terms and Conditions (design/WebLegal). The six
// headings are the board's; the text under them is a first draft written
// from docs/USER_JOURNEY.md and docs/ARCHITECTURE.md, for a lawyer to
// rewrite. Nothing here is in force.
import LegalPage from '../../../components/site/LegalPage';

export const metadata = { title: 'Terms and Conditions (draft) · Loudentify', robots: { index: false } };

const SECTIONS = [
  ['Who can use Loudentify',
    'You must be 18 or over to have an account. We ask for your date of birth at sign-up and check it once; we do not store it afterwards. If we later learn an account holder is under 18, we close the account.',
    'Give us accurate details and keep one account per person. We may refuse or close an account that breaks these terms, the Community Guidelines, or the law, and we will tell you why unless the law stops us.'],
  ['Your account',
    'Keep your login to yourself. If someone else uses your account, tell us straight away; until you do, we will treat actions on the account as yours.',
    'You can close your account at any time from Settings. We delete your personal data within 30 days, except what we must keep for money and legal records.'],
  ['Performing and what you upload',
    'Perform or upload only what you have the right to. If you play songs you did not write, you are responsible for having the rights the performance needs.',
    'When you perform on Loudentify you give us a licence to stream, record, store and show that performance on Loudentify and through the delivery services we use (today, YouTube), and to make clips you choose to make. The licence is non-exclusive: you keep your rights and can perform the same material anywhere else.',
    'Use of recordings to train or improve our automated production is separate, off by default, and only ever on with your explicit choice in the Artist agreement. You can turn it off at any time for future shows.',
    'We may remove content that breaks these terms or the Community Guidelines.'],
  ['Watching, commenting and voting',
    'Be decent in chat. The Community Guidelines say what is not allowed. We hide listed words before they appear, and we can remove accounts that break the rules.',
    'One vote per person per prompt. Votes come from fans, never from spending: tokens never change a result.'],
  ['Tokens, packs and payouts',
    'Tokens are a way to support artists during a show. They are not money, not a prize, and cannot be paid out to the fan who bought them. Watching is free; nobody needs tokens to watch, comment or vote.',
    'Of every token sent to an artist, 72.5% is credited to that artist. The rest covers payment processing and running Loudentify.',
    'Artists are paid out after an identity check through our payment provider. We may hold a payout where we suspect fraud, and we will say so.',
    'Prepaid packs for artists are one-off purchases. Nothing renews on its own. Refunds follow UK consumer law; tokens already sent to an artist are not refundable.',
    'Fans can set a daily spending limit in Settings. We apply a default limit to every account.'],
  ['Service and availability',
    'We do our best to keep shows running, but we cannot promise a perfect stream. If a show fails because of us, we will say so and, where it is fair, restore viewer-hours or tokens affected.',
    'We may change these terms. We will tell account holders at least 14 days before a change that affects them takes effect. Continuing to use Loudentify after that date means you accept the change.',
    'These terms are governed by the law of England and Wales.'],
];

export default function Terms() {
  return <LegalPage path="/legal/terms" title="Terms and Conditions" applies="Applies to everyone using Loudentify" sections={SECTIONS}
    summary="You must be 18 or over. Play or post only what you have the right to. Treat other people decently. We can remove content or accounts that break these rules. This summary is here to help, but the full text below is what counts." />;
}
