'use client';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import Link from 'next/link';

import { useConversation } from '@/lib/state/ConversationProvider';
import { signOut, openBillingPortal, startCheckout } from '@/lib/client-api';

export default function UserProfile() {
  const { session, isPro } = useConversation();

  if (!session) return null;

  const initial = session.userId?.[0]?.toUpperCase() || 'J';

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-full bg-fuchsia-600 text-sm font-medium text-white"
          aria-label="Open profile menu"
        >
          {initial}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={10}
          align="end"
          className="w-48 bg-neutral-900 border border-neutral-700 rounded-lg shadow-lg text-white text-sm z-50 p-1"
        >
          <DropdownMenu.Item asChild>
            <Link
              href="/account"
              className="flex w-full items-center p-2 rounded hover:bg-neutral-800 cursor-pointer outline-none"
            >
              <span className="text-white">Your Account</span>
            </Link>
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="h-[1px] bg-neutral-800 my-1" />

          {isPro ? (
            <DropdownMenu.Item
              onSelect={openBillingPortal}
              className="flex items-center gap-2 p-2 rounded hover:bg-fuchsia-600 cursor-pointer outline-none"
            >
              Manage Billing
            </DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item
              onSelect={startCheckout}
              className="flex items-center gap-2 p-2 rounded hover:bg-fuchsia-600 cursor-pointer outline-none"
            >
              Upgrade to Pro
            </DropdownMenu.Item>
          )}

          <DropdownMenu.Separator className="h-[1px] bg-neutral-800 my-1" />

          <DropdownMenu.Item
            onSelect={signOut}
            className="flex items-center gap-2 p-2 rounded text-red-400 hover:bg-red-500/20 cursor-pointer outline-none"
          >
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
