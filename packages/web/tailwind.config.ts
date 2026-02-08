import type { Config } from "tailwindcss";

const config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        "kira-bg": "#FBFBF8",
        "kira-accent": "#3B82F6",
        "kira-accent-dark": "#2563EB",
        "kira-surface": "#E8E4DE",
        "kira-blue-light": "#E0F2FE", // sky-100
        "kira-blue-dark": "#0284C7",  // sky-600
        
        // Tokyo Night Theme
        "tokyo-bg": "#1a1b26",
        "tokyo-fg": "#a9b1d6",
        "tokyo-accent": "#7aa2f7",
        "tokyo-card": "#24283b",
      },
      keyframes: {
        blob: {
          "0%": { transform: "translate(0px, 0px) scale(1)" },
          "33%": { transform: "translate(30px, -30px) scale(1.1)" },
          "66%": { transform: "translate(-20px, 20px) scale(0.9)" },
          "100%": { transform: "translate(0px, 0px) scale(1)" },
        },
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "spin-slow": "spin 12s linear infinite",
        blob: "blob 14s infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;

export default config;
