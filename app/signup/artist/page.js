import { redirect } from 'next/navigation';

export const metadata = { title: 'Artist Waitlist | Loudentify', description: 'Join the Loudentify artist waitlist.' };

export default function ArtistSignupPage() {
  redirect('/early-access');
}
