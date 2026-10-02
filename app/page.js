// / — Discover is home for everyone (docs/USER_JOURNEY.md: "Returning users
// land on Discover"). The pilot's front door moved to /pilot.
import { redirect } from 'next/navigation';
export default function Home() { redirect('/discover'); }
