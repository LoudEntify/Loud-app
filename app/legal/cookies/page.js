// /legal/cookies — the cookie notice (PRD 106, UK PECR). Describes what
// the banner actually controls (lib/consent.js), so it is factual rather
// than a draft, but it still awaits legal review.
import LegalPage from '../../../components/site/LegalPage';
import CookieChoices from '../../../components/site/CookieChoices';

export const metadata = { title: 'Cookies · Loudentify' };

const SECTIONS = [
  ['Cookies we always set',
    'Signing in needs a cookie, and the show screen keeps your place in a show. These are necessary to run the service and do not need your consent. Metering (how long a show was watched, counted against the artist’s hours) is pseudonymous and runs without cookies.'],
  ['The player',
    'Shows are delivered through a YouTube player loaded from YouTube’s privacy-enhanced domain. Loading it sets YouTube’s cookies. We do not load the player until you allow it; until then the show’s box shows a consent card instead.'],
  ['Analytics',
    'With your consent we keep pseudonymous notes on how the app is used (which screens, which buttons, how far people get). Never your name, your messages, or what you typed. You can turn this off below at any time.'],
  ['No advertising cookies', 'We do not run advertising, and no advertising cookies are set.'],
  ['Changing your mind', 'Use the buttons below, or clear your browser’s site data for loudentify.app and the banner asks again.'],
];

export default function Cookies() {
  return <LegalPage path="/legal/cookies" title="Cookies" applies="Applies to loudentify.app in a browser" sections={SECTIONS} draft
    summary="Signing in sets a cookie. The video player sets YouTube’s cookies, only after you allow it. Analytics are pseudonymous and only with your consent. No advertising cookies."><CookieChoices /></LegalPage>;
}
