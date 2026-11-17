import AccountSignInPage from '../../../components/AccountSignInPage';

export const metadata = { title: 'Artist Sign In | Loudentify', description: 'Sign in to your Loudentify artist account.' };
export default function ArtistSignInPage() { return <AccountSignInPage accountRole="artist" />; }
