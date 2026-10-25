export function impliedProbability(decimalOdds: number): number {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1 || decimalOdds > 10000) throw Error('Decimal odds must be greater than 1 and at most 10,000.');
  return 1 / decimalOdds;
}
export function expectedValue(decimalOdds: number, probability: number): number {
  impliedProbability(decimalOdds);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw Error('Invalid probability.');
  return probability * decimalOdds - 1;
}
export function evaluateParlay(legs: { decimalOdds: number; estimatedProbability?: number; gameId?: string }[], stake: number) {
  if (!Array.isArray(legs) || legs.length < 2 || legs.length > 10) throw Error('Choose between 2 and 10 legs.');
  if (!Number.isFinite(stake) || stake <= 0 || stake > 1000000) throw Error('Stake must be greater than zero and at most 1,000,000.');
  const seen = new Set<string>();
  for (const leg of legs) {
    if (!leg || typeof leg !== 'object') throw Error('Invalid leg.');
    impliedProbability(leg.decimalOdds);
    if (leg.estimatedProbability !== undefined && (!Number.isFinite(leg.estimatedProbability) || leg.estimatedProbability < 0 || leg.estimatedProbability > 1)) throw Error('Invalid probability.');
    if (leg.gameId) {
      if (typeof leg.gameId !== 'string') throw Error('Invalid game ID.');
      if (seen.has(leg.gameId)) throw Error('Use one leg per game. Same-game pricing requires a sportsbook correlation model.');
      seen.add(leg.gameId);
    }
  }
  const combinedDecimalOdds = legs.reduce((v, l) => v * l.decimalOdds, 1);
  const independentProbability = legs.every(l => l.estimatedProbability !== undefined) ? legs.reduce((v, l) => v * l.estimatedProbability!, 1) : null;
  return { combinedDecimalOdds, impliedBreakEvenProbability: 1 / combinedDecimalOdds, independentProbability,
    estimatedPayout: stake * combinedDecimalOdds, estimatedNetProfit: stake * (combinedDecimalOdds - 1),
    independenceWarning: 'Illustrative price only. Sportsbook eligibility, correlation, voids and price changes can alter the payout. Implied probability is not a prediction.' };
}
