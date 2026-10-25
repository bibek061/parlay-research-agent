import type { Game, Market } from './domain';
import { fetchOddsMarkets } from './odds-api';
import { fetchApiMarkets } from './api-sports';
import { fetchEspnMarkets } from './espn';
import { fallbackEnabled } from './research';
import { fetchTheOddsMarkets, type MarketKind } from './the-odds-api';
export async function getMarkets(game: Game, kind: MarketKind = 'all') {
  if (game.phase !== 'scheduled' || Date.parse(game.start) <= Date.now()) return { markets: [] as Market[], notice: 'Only upcoming, scheduled games can be added to a pre-match parlay.' };
  const messages: string[] = [];
  const providers = [
    ...(process.env.THE_ODDS_API_KEY?.trim() ? [(g: Game) => fetchTheOddsMarkets(g, kind)] : []),
    ...(process.env.ODDS_API_KEY?.trim() ? [fetchOddsMarkets] : []),
    fetchApiMarkets, ...(fallbackEnabled() ? [fetchEspnMarkets] : []),
  ];
  for (const provider of providers) {
    try {
      const result = await provider(game);
      const markets = result.markets.filter(m => kind === 'all' || m.kind === kind);
      if (markets.length) return { ...result, markets, notice: [...messages, result.notice].join(' ') };
      messages.push(result.notice);
    } catch (error) { messages.push(error instanceof Error ? error.message : 'Odds provider unavailable.'); }
  }
  return { markets: [] as Market[], notice: `${messages.join(' ')} No priced markets are available. You can enter a sportsbook line manually.` };
}
