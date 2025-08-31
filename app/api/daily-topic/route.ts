import { NextResponse } from 'next/server';

export const runtime = 'edge';

const TOPICS: string[] = [
  'What was the highlight of your day?',
  'Tell me about a game you love and why.',
  'What’s a small habit that improved your life?',
  'If you could learn one skill instantly, what would it be?',
  'What’s a comfort show or anime you always go back to?',
  'What’s one thing you want to accomplish this week?',
  'Describe a perfect lazy Sunday.',
  'Which fictional world would you live in?',
  'What’s a personal rule you try to live by?',
  'What’s your current hyperfixation?',
  // ... add more to reach 50-100 in a real pass
];

function dayOfYearUTC(date = new Date()): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const diff = date.getTime() - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export async function GET() {
  const index = dayOfYearUTC() % TOPICS.length;
  return NextResponse.json({ topic: TOPICS[index] });
}
