export default function PulsingOrb() {
  return (
    <div className="relative h-20 w-20">
      <div className="absolute inset-0 rounded-full bg-white/20 animate-ping"></div>
      <div className="absolute inset-2 rounded-full bg-white/80"></div>
    </div>
  );
}
