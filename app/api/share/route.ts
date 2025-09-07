import { NextRequest } from 'next/server';
// @ts-ignore satori types can be problematic under bundler resolution; runtime is fine
import satori from 'satori';
// @ts-ignore sharp types optional at build
import sharp from 'sharp';

export const runtime = 'nodejs';

// Tiny hyperscript helper for satori without JSX
function h(tag: any, props: any, ...children: any[]) {
  return { type: tag, props: { ...props, children } } as any;
}

export async function POST(req: NextRequest) {
  try {
    const { userMessage, kiraMessage } = await req.json();
    if (!userMessage || !kiraMessage) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
    }

    const width = 1200;
    const height = 630;

    const tree = h(
      'div',
      {
        style: {
          width: `${width}px`,
          height: `${height}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0b0b12',
          color: 'white',
          padding: '40px',
          fontFamily: 'Inter',
        },
      },
      h('div', { style: { opacity: 0.85, fontSize: 28 } }, 'ai-media-companion'),
      h(
        'div',
        { style: { display: 'flex', gap: '24px' } },
        h(
          'div',
          {
            style: {
              flex: 1,
              background: 'rgba(255,255,255,0.06)',
              padding: '24px',
              borderRadius: 16,
            },
          },
          h('div', { style: { opacity: 0.7, fontSize: 20, marginBottom: 8 } }, 'You'),
          h('div', { style: { fontSize: 30, lineHeight: 1.3 } }, String(userMessage)),
        ),
        h(
          'div',
          {
            style: {
              flex: 1,
              background: 'rgba(168,85,247,0.18)',
              padding: '24px',
              borderRadius: 16,
            },
          },
          h('div', { style: { opacity: 0.8, fontSize: 20, marginBottom: 8 } }, 'Kira'),
          h('div', { style: { fontSize: 30, lineHeight: 1.3 } }, String(kiraMessage)),
        ),
      ),
      h('div', { style: { opacity: 0.6, fontSize: 22 } }, 'kira.ai • Talk with Kira'),
    );

    const svg = await satori(tree as any, { width, height, fonts: [] });
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Server error' }), { status: 500 });
  }
}
