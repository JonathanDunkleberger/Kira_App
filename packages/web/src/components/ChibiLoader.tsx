"use client";
import React, { useState, useEffect, useRef } from "react";

const CHIBI_IMAGES = [
  "/models/Suki/chibi-1.png",
  "/models/Suki/chibi-2.png",
  "/models/Suki/chibi-3.png",
  "/models/Suki/chibi-4.png",
  "/models/Suki/chibi-5.png",
];

const CYCLE_MS = 1500;
const FADE_MS = 400;

interface ChibiLoaderProps {
  message?: string;
  size?: number;
}

export default function ChibiLoader({ message = "Kira is getting ready…", size = 140 }: ChibiLoaderProps) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * CHIBI_IMAGES.length));
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      // Fade out
      setVisible(false);
      // After fade-out completes, switch image and fade in
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % CHIBI_IMAGES.length);
        setVisible(true);
      }, FADE_MS);
    }, CYCLE_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
        zIndex: 10,
      }}
    >
      {/* Chibi image with float + fade */}
      <div
        style={{
          width: size,
          height: size,
          animation: "chibi-float 2.5s ease-in-out infinite",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img
          src={CHIBI_IMAGES[index]}
          alt="Loading"
          draggable={false}
          style={{
            width: size,
            height: size,
            objectFit: "contain",
            opacity: visible ? 1 : 0,
            transition: `opacity ${FADE_MS}ms ease-in-out`,
            filter: "drop-shadow(0 4px 20px rgba(107,125,179,0.25))",
            pointerEvents: "none",
            userSelect: "none",
          }}
        />
      </div>

      {/* Loading text */}
      <p
        style={{
          marginTop: 20,
          fontSize: 14,
          fontWeight: 300,
          fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
          color: "rgba(201,209,217,0.5)",
          letterSpacing: "0.03em",
          animation: "chibi-text-pulse 2s ease-in-out infinite",
        }}
      >
        {message}
      </p>
    </div>
  );
}
