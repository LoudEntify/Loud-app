import AccountSignInPage from '../../../components/AccountSignInPage';
export const metadata = { title: 'Artist Signup | Loudentify', description: 'Create your Loudentify artist account.' };
export default function ArtistSignupPage() { return <AccountSignInPage mode="signup" accountRole="artist" />; }
