import { redirect } from 'next/navigation';

export const metadata = { title: 'Join the Waitlist | Loudentify', description: 'Join the Loudentify early-access waitlist.' };

export default function SignupPage() {
  redirect('/early-access');
}
