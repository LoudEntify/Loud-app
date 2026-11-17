import AccountDashboard from '../../components/AccountDashboard';

export const metadata = { title: 'Your Dashboard | Loudentify', description: 'Your Loudentify dashboard.' };

// Resolve the destination from the authenticated profile, never a URL role hint.
export default function DashboardPage() { return <AccountDashboard />; }
