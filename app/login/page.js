import { Suspense } from 'react';
import ViewerShell from '../../components/viewer/ViewerShell';
import AuthPage from '../../components/viewer/AuthPage';
export const metadata = { title: 'Log in · Loudentify' };
export default function LoginPage({ searchParams }) {
  return <ViewerShell tabs={false}><Suspense><AuthPage mode="login" next={searchParams?.next || ''} /></Suspense></ViewerShell>;
}
