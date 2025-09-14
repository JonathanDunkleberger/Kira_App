"use client";
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';

import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/card';

export default function HomePage() {
  const router = useRouter();
  const { user } = useUser();

  const startConversation = useCallback(() => {
    const id = crypto.randomUUID();
    router.push(`/c/${id}`);
  }, [router]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full flex flex-col items-center text-center gap-8">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight">Welcome{user?.firstName ? `, ${user.firstName}` : ''}</h1>
          <p className="text-gray-600 dark:text-gray-400 text-lg">Ready to speak with Kira? Start a new voice conversation instantly.</p>
        </div>
        <button
          onClick={startConversation}
          className="group w-full text-left focus:outline-none"
          aria-label="Start a conversation"
        >
          <Card className="cursor-pointer group-hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle>Start Conversation</CardTitle>
              <CardDescription>Open a fresh session with Kira</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                A unique session ID will be created and you will connect to the real-time service.
              </div>
            </CardContent>
            <CardFooter>
              <div className="ml-auto text-primary font-medium group-hover:underline">Begin →</div>
            </CardFooter>
          </Card>
        </button>
      </div>
    </main>
  );
}
