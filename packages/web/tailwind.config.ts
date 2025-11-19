import type { Config } from "tailwindcss";

const config = {
  darkMode: ["class"],
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
        "kira-green": "#D4D7C2",
        "kira-green-dark": "#C2C6A3",
        "kira-orb": "#D4D7C2",
        "kira-orb-shadow": "rgba(212, 215, 194, 0.5)",
        "kira-blue-light": "#E0F2FE", // sky-100
        "kira-blue-dark": "#0284C7",  // sky-600
      },
      keyframes: {
        blob: {
          "0%": { transform: "translate(0px, 0px) scale(1)" },
          "33%": { transform: "translate(30px, -30px) scale(1.1)" },
          "66%": { transform: "translate(-20px, 20px) scale(0.9)" },
          "100%": { transform: "translate(0px, 0px) scale(1)" },
        },
        flow: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "25%": { transform: "translate(10px, -10px) scale(1.05)" },
          "50%": { transform: "translate(-5px, 15px) scale(1)" },
          "75%": { transform: "translate(-15px, -5px) scale(0.95)" },
        },
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "spin-slow": "spin 12s linear infinite",
        blob: "blob 14s infinite",
        flow: "flow 15s ease-in-out infinite",
      },
      boxShadow: {
        orb: "0 0 25px 10px rgba(212, 215, 194, 0.5)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;

export default config;
