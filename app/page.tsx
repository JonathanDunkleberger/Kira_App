import { cookies } from 'next/headers';
import Link from 'next/link';

import { CharacterCard } from '../components/ui/CharacterCard';

function greet(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Morning';
  if (h < 18) return 'Afternoon';
  return 'Evening';
}

export default async function HomePage() {
  const jar = await cookies();
  const name = jar.get?.('kira_name')?.value || 'there';
  const conversationId = crypto.randomUUID();
  return (
    <main className="min-h-[calc(100vh-3rem)] flex items-center justify-center p-6">
      <CharacterCard
        name="Kira"
        subtitle={`${greet()}, ${name}`}
        description="Real-time voice conversation. Just talk—she listens and replies."
        onPrimaryAction={() => {
          try { sessionStorage.setItem('kira_auto_start', '1'); } catch {}
        }}
        footer={
          <Link
            href={`/c/${conversationId}`}
            className="text-xs text-cream-300/70 hover:text-cream-100 transition"
          >
            Start new conversation →
          </Link>
        }
      />
    </main>
  );
}
