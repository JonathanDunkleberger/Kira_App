'use client';
export default function Transcript({ text }: { text: string }) {
  if (!text) return null;
  return <p className="text-sm text-gray-300">{text}</p>;
}
