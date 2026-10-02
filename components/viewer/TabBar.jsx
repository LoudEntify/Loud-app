'use client';
// components/viewer/TabBar.jsx — the three doors (Discover, Live, Profile)
// plus Create for artists only (decided 30 Sept: hidden for viewers).
// Hidden on the show screen and in camera mode. On computers it becomes
// the top bar (ResponsiveRules.dc.html: "Full sidebar with labels").
import { usePathname } from 'next/navigation';
import { Home, LiveDot, Person, Plus } from './Icons';
import { useSession } from '../../lib/useSession';

export default function TabBar({ variant = 'light' }) {
  const path = usePathname() || '';
  const { profile } = useSession();
  const isArtist = profile?.role === 'artist';
  const Tab = ({ href, label, Icon, match }) => {
    const current = match.some((m) => path === m || path.startsWith(m + '/'));
    return (
      <a href={href} className="v-tab" aria-current={current ? 'page' : undefined}>
        <span className="v-tab-icon"><Icon /></span>
        <span>{label}</span>
      </a>
    );
  };
  return (
    <nav aria-label="Main" className={`v-tabbar v-tabbar-${variant}`}>
      <Tab href="/discover" label="Discover" Icon={Home} match={['/discover', '/']} />
      <Tab href="/live" label="Live" Icon={LiveDot} match={['/live']} />
      {isArtist && (
        <a href="/artist/create" className="v-tab" aria-label="Create">
          <span className="v-tab-create"><Plus size={20} /></span>
          <span>Create</span>
        </a>
      )}
      <Tab href={profile ? '/profile' : '/signup'} label="Profile" Icon={Person} match={['/profile', '/signup', '/login', '/wallet', '/settings']} />
    </nav>
  );
}
