"use client";
import { useState, useRef, KeyboardEvent } from "react";

interface TextInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
  kiraState: string;
  theme?: "dark" | "light";
}

export default function TextInput({ onSend, disabled, kiraState, theme = "dark" }: TextInputProps) {
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
  const isDark = theme === "dark";

  return (
    <div
      className="flex items-center w-full max-w-[320px] pb-1 transition-all duration-300"
      style={{
        borderBottom: `1px solid ${
          isDark
            ? `rgba(139,157,195,${isActive ? 0.15 : 0.04})`
            : `rgba(90,100,140,${isActive ? 0.2 : 0.08})`
        }`,
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
        className={`flex-1 bg-transparent border-none outline-none text-sm font-light tracking-[0.01em] py-2 disabled:opacity-50 ${
          isDark ? "placeholder:text-[rgba(139,157,195,0.3)]" : "placeholder:text-[rgba(90,100,140,0.35)]"
        }`}
        style={{
          fontFamily: "inherit",
          color: isDark ? "rgba(201,209,217,0.7)" : "rgba(50,55,70,0.8)",
        }}
      />
      {text.trim() && (
        <button
          onClick={handleSend}
          disabled={disabled}
          className="bg-transparent border-none cursor-pointer px-2 py-1 text-[13px] transition-colors duration-200 disabled:opacity-50"
          style={{
            color: isDark ? "rgba(139,157,195,0.6)" : "rgba(90,100,140,0.5)",
          }}
        >
          ↵
        </button>
      )}
    </div>
  );
}
