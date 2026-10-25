export const TIME_ZONE = 'America/New_York';
export const SPORTS = [
  { id: 'soccer', label: 'Soccer', icon: '⚽', host: 'v3.football.api-sports.io' },
  { id: 'nba', label: 'NBA', icon: '🏀', host: 'v2.nba.api-sports.io' },
  { id: 'baseball', label: 'Baseball', icon: '⚾', host: 'v1.baseball.api-sports.io' },
  { id: 'hockey', label: 'Hockey', icon: '🏒', host: 'v1.hockey.api-sports.io' },
  { id: 'basketball', label: 'Basketball', icon: '🏀', host: 'v1.basketball.api-sports.io' },
  { id: 'afl', label: 'AFL', icon: '🏉', host: 'v1.afl.api-sports.io' },
  { id: 'nfl', label: 'NFL', icon: '🏈', host: 'v1.american-football.api-sports.io' },
] as const;
export type Sport = typeof SPORTS[number]['id'];
export const isSport = (value: unknown): value is Sport => SPORTS.some(s => s.id === value);
export interface Game {
  id: string; providerId: number; sport: Sport; league: string; season: string;
  home: string; away: string; homeId: number; awayId: number; start: string; status: string;
  phase: 'scheduled' | 'live' | 'finished' | 'unavailable';
  homeScore: number | null; awayScore: number | null;
  source: 'api-sports' | 'espn'; espnPath?: string;
  oddsSport?: Sport; oddsGameId?: number;
}
export interface ProviderStatus {
  sport: Sport; status: 'ready' | 'empty' | 'error' | 'fallback';
  games: number; message: string;
}
export interface Slate {
  date: string; timeZone: string; fetchedAt: string; games: Game[]; providers: ProviderStatus[]; storageWarning?: string;
}
export interface Market {
  id: string; gameId: string; sport: Sport; kind: 'game' | 'player'; name: string;
  selection: string; decimalOdds: number; bookmaker: string; updatedAt: string | null; fetchedAt: string;
}
export interface Leg {
  id: string; gameId: string; sport: Sport; matchup: string; start: string; selection: string;
  market: string; decimalOdds: number; bookmaker: string; kind: 'game' | 'player';
  source: 'provider' | 'manual'; estimatedProbability?: number;
}
export interface Player { id: number; name: string; }
export interface PlayerLog { date: string; value: number; }
