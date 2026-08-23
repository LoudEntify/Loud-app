import { Suspense } from 'react';
import Auth from '../../components/Auth';

export const metadata = {
  title: 'Log in · Loudentify',
  description: 'Log in or create your Loudentify account',
};

export default function AuthPage() {
  return (
    <main>
      {/* Auth reads ?next= via useSearchParams(), which the app router
          requires a Suspense boundary for -- same convention as /live
          and /egress. */}
      <Suspense fallback={null}>
        <Auth />
      </Suspense>
    </main>
  );
}
