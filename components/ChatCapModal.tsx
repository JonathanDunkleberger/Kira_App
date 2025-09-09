'use client';
export default function ChatCapModal({ onNewChat }: { onNewChat: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white text-black rounded-xl p-6 max-w-sm w-full space-y-3 shadow-xl">
        <h2 className="text-lg font-semibold">Chat session reached its limit</h2>
        <p className="text-sm text-gray-600">
          This conversation hit its per-chat limit. Start a new chat to keep going.
        </p>
        <div className="flex gap-2 justify-end">
          <button className="px-3 py-1.5 rounded bg-black text-white" onClick={onNewChat}>
            Start new chat
          </button>
        </div>
      </div>
    </div>
  );
}
