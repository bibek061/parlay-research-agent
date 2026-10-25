import { NextResponse } from 'next/server';
import { evaluateParlay } from '../../../lib/math';
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || !Array.isArray(body.legs)) throw Error('Provide a list of legs.');
    return NextResponse.json(evaluateParlay(body.legs, body.stake ?? 10));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid input.' }, { status: 400 }); }
}
