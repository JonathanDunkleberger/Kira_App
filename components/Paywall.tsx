"use client";

export default function Paywall({ onUnlock }: { onUnlock: () => void }) {
  return (
    <div className="rounded-xl border border-purple-700/40 bg-purple-900/10 p-4 text-gray-100">
      <p className="mb-3">You’ve used your free minutes.</p>
      <button onClick={onUnlock} className="px-4 py-2 rounded-md bg-purple-600 text-white">
        Unlock minutes ($1.99)
      </button>
    </div>
  );
}
