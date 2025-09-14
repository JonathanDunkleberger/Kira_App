export default function PulsingOrb({
  isProcessing = false,
  isSpeaking = false,
}: {
  isProcessing?: boolean;
  isSpeaking?: boolean;
}) {
  const glow = isProcessing
    ? 'from-amber-300 to-amber-600'
    : isSpeaking
      ? 'from-fuchsia-400 to-purple-700'
      : 'from-fuchsia-400 to-purple-700';

  return (
    <div className="relative h-full w-full">
      <div
        className={`absolute inset-0 rounded-full bg-gradient-to-br ${glow} opacity-50 blur-md animate-pulse`}
      />
      <div className={`absolute inset-2 rounded-full bg-gradient-to-br ${glow}`} />
    </div>
  );
}
