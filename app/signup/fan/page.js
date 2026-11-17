import AccountSignInPage from '../../../components/AccountSignInPage';
export const metadata = { title: 'Fan Signup | Loudentify', description: 'Create your Loudentify fan account.' };
export default function FanSignupPage() { return <AccountSignInPage mode="signup" accountRole="fan" />; }
