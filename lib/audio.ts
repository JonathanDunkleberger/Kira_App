export async function playMp3Base64(b64: string, onEnd?: () => void) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => { URL.revokeObjectURL(url); onEnd?.(); };
  await audio.play();
  return audio;
}
