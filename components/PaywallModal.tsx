'use client';
export default function PaywallModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white text-black rounded-xl p-6 max-w-sm w-full space-y-3 shadow-xl">
        <h2 className="text-lg font-semibold">Daily free limit reached</h2>
        <p className="text-sm text-gray-600">
          You’ve used your free minutes for today. Come back tomorrow or upgrade to Pro for
          unlimited daily chats.
        </p>
        <div className="flex gap-2 justify-end">
          <button className="px-3 py-1.5 rounded border" onClick={onClose}>
            Close
          </button>
          <a className="px-3 py-1.5 rounded bg-black text-white" href="/upgrade">
            Upgrade
          </a>
        </div>
      </div>
    </div>
  );
}
