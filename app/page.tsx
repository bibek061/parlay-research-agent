import Dashboard from './components/dashboard';
import { easternDate } from '../lib/time';
import { SPORTS } from '../lib/domain';
import { providerKey } from '../lib/api-sports';
export const dynamic = 'force-dynamic';
export default function Home() {
  return <Dashboard today={easternDate()} config={{ apiSports: SPORTS.some(s => !!providerKey(s.id)), theOdds: !!process.env.THE_ODDS_API_KEY?.trim(), odds: !!process.env.ODDS_API_KEY?.trim(), espn: process.env.ESPN_FALLBACK_ENABLED !== 'false', scheduler: !!process.env.RESEARCH_API_TOKEN }} />;
}
