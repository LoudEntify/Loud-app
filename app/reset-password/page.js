import ViewerShell from '../../components/viewer/ViewerShell';
import { ResetPasswordScreen } from '../../components/viewer/ForgotPasswordScreen';
export const metadata = { title: 'Choose a new password · Loudentify' };
export default function Page() { return <ViewerShell tabs={false}><ResetPasswordScreen /></ViewerShell>; }
