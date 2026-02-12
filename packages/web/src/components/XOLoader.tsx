import React from "react";

export default function XOLoader({ size = 48 }: { size?: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
      }}
    >
      <svg
        viewBox="0 0 48 48"
        width={size}
        height={size}
        style={{ animation: "xo-rotate 1.4s linear infinite" }}
      >
        {/* X shape */}
        <line x1="8" y1="8" x2="20" y2="20" stroke="rgba(100,149,237,0.8)" strokeWidth="3" strokeLinecap="round" />
        <line x1="20" y1="8" x2="8" y2="20" stroke="rgba(100,149,237,0.8)" strokeWidth="3" strokeLinecap="round" />
        {/* O shape */}
        <circle
          cx="34"
          cy="28"
          r="8"
          fill="none"
          stroke="rgba(100,149,237,0.8)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="50.26"
          strokeDashoffset="12"
          style={{ animation: "xo-dash 1.4s ease-in-out infinite" }}
        />
      </svg>
      <style>{`
        @keyframes xo-rotate {
          100% { transform: rotate(360deg); }
        }
        @keyframes xo-dash {
          0% { stroke-dashoffset: 50.26; }
          50% { stroke-dashoffset: 12; }
          100% { stroke-dashoffset: 50.26; }
        }
      `}</style>
    </div>
  );
}
