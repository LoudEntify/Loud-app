import AccountDashboard from '../../../components/AccountDashboard';
export const metadata = { title: 'Artist Dashboard | Loudentify', description: 'Your artist tools, performances and account.' };
export default function ArtistDashboardPage() { return <AccountDashboard accountRole="artist" />; }
