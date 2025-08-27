"use client";
import { useEffect, useRef, useState } from "react";
import { sendUtterance } from "@/lib/client-api";

type Win = Window & { webkitSpeechRecognition?: any };

export default function PushToTalk() {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [showPaywall, setShowPaywall] = useState(false);
  const recRef = useRef<any>(null);

  useEffect(() => {
    const w = window as unknown as Win;
    if ("webkitSpeechRecognition" in w && !recRef.current) {
      const rec = new w.webkitSpeechRecognition();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = "en-US";

      rec.onresult = (e: any) => {
        let txt = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          txt += e.results[i][0].transcript;
        }
        setTranscript(txt.trim());
      };
      rec.onerror = () => setRecording(false);
      rec.onend = () => setRecording(false);
      recRef.current = rec;
    }
  }, []);

  async function handlePress() {
    setTranscript("");
    setReply("");
    setShowPaywall(false);
    if (recRef.current) {
      setRecording(true);
      recRef.current.start();
    } else {
      const manual = prompt("Your mic isn’t supported. Type your message:");
      if (manual) await handleSend(manual);
    }
  }

  async function handleRelease() {
    if (recRef.current && recording) {
      recRef.current.stop();
    }
    if (transcript) await handleSend(transcript);
  }

  async function handleSend(text: string) {
    try {
      const res = await sendUtterance({ text });
      setReply(res.reply ?? "");
      if (res.audioBase64) {
        const audio = new Audio(`data:audio/mp3;base64,${res.audioBase64}`);
        await audio.play().catch(() => {});
      }
    } catch (err: any) {
      if (err?.code === 402) {
        setShowPaywall(true);
        return;
      }
      console.error(err);
      alert(err?.message || "Failed to send.");
    }
  }

  return (
    <div className="flex flex-col gap-4 items-center">
      <button
        onMouseDown={handlePress}
        onMouseUp={handleRelease}
        onTouchStart={handlePress}
        onTouchEnd={handleRelease}
        className={`px-6 py-4 rounded-full text-white ${recording ? "bg-purple-700" : "bg-purple-600"} shadow-lg active:scale-95 transition`}
        aria-pressed={recording}
      >
        {recording ? "Listening…" : "Hold to Talk"}
      </button>

      {transcript ? (
        <p className="text-sm text-gray-300 max-w-prose text-center">{transcript}</p>
      ) : (
        <p className="text-sm text-gray-500">Hold the button, speak, then release.</p>
      )}

      {reply && (
        <div className="w-full max-w-2xl rounded-xl border border-purple-700/40 bg-purple-900/10 p-4 text-gray-100">
          {reply}
        </div>
      )}

      {showPaywall && (
        <div className="w-full max-w-md rounded-xl border border-purple-700/40 bg-purple-900/10 p-4 text-gray-100">
          <p className="mb-3">You’ve used your free minutes.</p>
          <button
            onClick={async () => {
              // Create a Checkout session and redirect
              const r = await fetch("/api/stripe/checkout", { method: "POST" });
              if (!r.ok) {
                const body = await r.json().catch(() => ({}));
                alert(body.error || "Failed to start checkout.");
                return;
              }
              const { url } = await r.json();
              window.location.href = url;
            }}
            className="px-4 py-2 rounded-md bg-purple-600 text-white"
          >
            Unlock minutes ($1.99)
          </button>
        </div>
      )}
    </div>
  );
}
