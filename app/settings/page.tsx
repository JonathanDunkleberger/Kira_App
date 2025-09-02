"use client";

import { useConversation } from '@/lib/state/ConversationProvider';
import { clearAllConversations } from '@/lib/client-api';
import Link from 'next/link';

export default function SettingsPage() {
  const { session } = useConversation();

  return (
    <main className="min-h-screen bg-[#0b0b12] text-white p-4 md:p-8">
      <div className="w-full max-w-lg mx-auto">
        <h1 className="text-2xl font-semibold mb-6">Settings</h1>

        {session && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-medium">Account</h2>
              <p className="text-sm text-white/50 mb-3">Manage your account and subscription.</p>
              <Link href="/account" className="px-4 py-2 text-sm rounded-lg border border-white/15 hover:bg-white/5">
                Go to Account Page
              </Link>
            </div>

            <div className="border-t border-red-500/20 pt-6">
              <h2 className="text-lg font-medium text-red-400">Danger Zone</h2>
              <p className="text-sm text-white/50 mb-3">Permanently delete all of your conversations.</p>
              <button
                onClick={clearAllConversations}
                className="px-4 py-2 text-sm rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                Clear Chat History
              </button>
            </div>
          </div>
        )}

        {!session && (
          <div>
            <p className="text-white/70">
              <Link href="/sign-up" className="text-fuchsia-400 hover:underline">Create an account</Link> or <Link href="/sign-in" className="text-fuchsia-400 hover:underline">log in</Link> to manage your settings and save your chat history.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
