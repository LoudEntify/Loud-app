import { Suspense } from 'react';
import ViewerShell from '../../components/viewer/ViewerShell';
import AuthPage from '../../components/viewer/AuthPage';
export const metadata = { title: 'Sign up · Loudentify' };
export default function SignUpPage({ searchParams }) {
  return <ViewerShell tabs={false}><Suspense><AuthPage mode="signup" trigger={searchParams?.trigger || 'direct'} next={searchParams?.next || ''} /></Suspense></ViewerShell>;
}
