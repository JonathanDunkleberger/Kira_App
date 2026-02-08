"use client";
import { useState, useRef, KeyboardEvent } from "react";

interface TextInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
  kiraState: string;
}

export default function TextInput({ onSend, disabled, kiraState }: TextInputProps) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isActive = focused || !!text;

  return (
    <div
      className="flex items-center w-full max-w-[320px] pb-1 transition-all duration-300"
      style={{
        borderBottom: `1px solid rgba(139,157,195,${isActive ? 0.15 : 0.04})`,
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message..."
        disabled={disabled}
        className="flex-1 bg-transparent border-none outline-none text-sm font-light tracking-[0.01em] py-2 disabled:opacity-50 placeholder:text-[rgba(139,157,195,0.3)]"
        style={{
          fontFamily: "inherit",
          color: "rgba(201,209,217,0.7)",
        }}
      />
      {text.trim() && (
        <button
          onClick={handleSend}
          disabled={disabled}
          className="bg-transparent border-none cursor-pointer px-2 py-1 text-[13px] transition-colors duration-200 disabled:opacity-50"
          style={{
            color: "rgba(139,157,195,0.6)",
          }}
        >
          ↵
        </button>
      )}
    </div>
  );
}
