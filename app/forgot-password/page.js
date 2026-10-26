import ViewerShell from '../../components/viewer/ViewerShell';
import { ForgotPasswordScreen } from '../../components/viewer/ForgotPasswordScreen';
export const metadata = { title: 'Forgot password · Loudentify' };
export default function Page() { return <ViewerShell tabs={false}><ForgotPasswordScreen /></ViewerShell>; }
