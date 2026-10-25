import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSlate, saveSnapshot } from '../../../lib/research';
import { easternDate, validateDate } from '../../../lib/time';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    const date = validateDate(new URL(req.url).searchParams.get('date') || easternDate());
    return NextResponse.json(await getSlate(date), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load research.' }, { status: 400 }); }
}
export async function POST(req: Request) {
  const token = process.env.RESEARCH_API_TOKEN;
  const actual = Buffer.from(req.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${token || ''}`);
  if (!token || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const date = validateDate(new URL(req.url).searchParams.get('date') || easternDate());
    const slate = await saveSnapshot(await getSlate(date));
    const failed = slate.providers.every(p => p.status === 'error');
    return NextResponse.json({ ...slate, status: failed ? 'unavailable' : slate.providers.some(p => p.status === 'error') ? 'partial' : 'complete' }, { status: failed ? 503 : slate.storageWarning ? 500 : 200 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Research failed.' }, { status: 400 }); }
}
