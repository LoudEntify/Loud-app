import AccountDashboard from '../../../components/AccountDashboard';
export const metadata = { title: 'Fan Dashboard | Loudentify', description: 'Your music, artists and fan account.' };
export default function FanDashboardPage() { return <AccountDashboard accountRole="fan" />; }
