export default function Transcript({ items }: { items: { user: string; reply: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="grid-gap">
      {items.map((t, i) => (
        <div key={i} className="card">
          <div className="subtle text-xs mb-1">You</div>
          <div className="mb-2">{t.user}</div>
          <div className="subtle text-xs mb-1">Kira</div>
          <div>{t.reply}</div>
        </div>
      ))}
    </div>
  );
}
