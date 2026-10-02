// /u/:username — public profile. /@username is rewritten here by middleware.js.
import { createClient } from '@supabase/supabase-js';
import ViewerShell from '../../../components/viewer/ViewerShell';
import PublicProfile from '../../../components/viewer/PublicProfile';

export async function generateMetadata({ params }) {
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data } = await sb.from('public_profiles').select('display_name, bio, avatar_url').eq('username', params.username).maybeSingle();
    if (!data) return { title: 'Profile · Loudentify' };
    const title = `${data.display_name} · Loudentify`;
    return { title, description: data.bio || `${data.display_name} on Loudentify`, openGraph: { title, description: data.bio || '', images: data.avatar_url ? [{ url: data.avatar_url }] : undefined } };
  } catch { return { title: 'Profile · Loudentify' }; }
}
export default function ProfilePage({ params }) {
  return <ViewerShell><PublicProfile username={params.username} /></ViewerShell>;
}
