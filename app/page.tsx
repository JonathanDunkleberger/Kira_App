'use client';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useEffect } from 'react';

export default function HomePage() {
  const router = useRouter();
  const { user, isLoaded } = useUser();

  useEffect(() => {
    if (isLoaded) {
      const newConversationId = crypto.randomUUID();
      router.push(`/c/${newConversationId}`);
    }
  }, [isLoaded, user, router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center">
        <h1 className="text-4xl font-bold">Kira AI</h1>
        <p className="mt-4 text-lg text-gray-600">Please wait, starting your conversation...</p>
      </div>
    </main>
  );
}
