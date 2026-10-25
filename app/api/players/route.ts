import { NextResponse } from 'next/server';
import { findGame } from '../../../lib/research';
import { playerHistory, playerRoster } from '../../../lib/players';
import { fallbackEnabled } from '../../../lib/research';
import { easternDate, validateDate } from '../../../lib/time';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    if (!fallbackEnabled()) throw Error('Enable ESPN_FALLBACK_ENABLED for player game-log research.');
    const params = new URL(req.url).searchParams;
    const game = await findGame(validateDate(params.get('date') || easternDate()), params.get('game') || '');
    return NextResponse.json(params.get('player') ? await playerHistory(game, params.get('player')!) : await playerRoster(game));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Player data unavailable.' }, { status: 400 }); }
}
