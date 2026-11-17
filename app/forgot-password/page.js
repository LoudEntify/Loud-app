import AccountSignInPage from '../../components/AccountSignInPage';
export const metadata = { title: 'Forgot Password | Loudentify', robots: { index: false, follow: false } };
export default function ForgotPasswordPage() { return <AccountSignInPage mode="forgot" />; }
