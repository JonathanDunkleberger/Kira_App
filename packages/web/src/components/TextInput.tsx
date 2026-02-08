"use client";
import { useState, useRef, KeyboardEvent } from "react";
import { Send } from "lucide-react";

interface TextInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
  kiraState: string;
}

export default function TextInput({ onSend, disabled, kiraState }: TextInputProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || kiraState !== "listening") return;
    onSend(trimmed);
    setText("");
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.03] rounded-xl border border-white/[0.06] max-w-[400px] w-full">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={kiraState === "listening" ? "Type a message..." : "Kira is thinking..."}
        disabled={disabled || kiraState !== "listening"}
        className="flex-1 bg-transparent border-none outline-none text-[#C9D1D9] text-sm font-inherit placeholder:text-gray-600 disabled:opacity-50"
      />
      <button
        onClick={handleSend}
        disabled={!text.trim() || disabled || kiraState !== "listening"}
        className={`border-none rounded-lg p-1.5 flex items-center transition-all duration-200 ${
          text.trim()
            ? "bg-[rgba(107,125,179,0.2)] text-[#8B9DC3] cursor-pointer hover:bg-[rgba(107,125,179,0.3)]"
            : "bg-transparent text-gray-700 cursor-default"
        } disabled:opacity-50 disabled:cursor-default`}
      >
        <Send size={16} />
      </button>
    </div>
  );
}
