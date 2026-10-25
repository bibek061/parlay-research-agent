import { NextResponse } from 'next/server';
import { findGame } from '../../../lib/research';
import { getMarkets } from '../../../lib/markets';
import { easternDate, validateDate } from '../../../lib/time';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const kind = params.get('kind') || 'all';
    if (kind !== 'all' && kind !== 'game' && kind !== 'player') throw Error('Market kind must be game, player or all.');
    const game = await findGame(validateDate(params.get('date') || easternDate()), params.get('game') || '');
    return NextResponse.json(await getMarkets(game, kind));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Markets unavailable.' }, { status: 400 }); }
}
