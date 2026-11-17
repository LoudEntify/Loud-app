import AccountSignInPage from '../../../components/AccountSignInPage';

export const metadata = { title: 'Fan Sign In | Loudentify', description: 'Sign in to your Loudentify fan account.' };
export default function FanSignInPage() { return <AccountSignInPage accountRole="fan" />; }
