import { redirect } from 'next/navigation';

export const metadata = { title: 'Fan Waitlist | Loudentify', description: 'Join the Loudentify fan waitlist.' };

export default function FanSignupPage() {
  redirect('/early-access');
}
