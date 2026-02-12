"use client";

import { useEffect, useRef } from "react";

export default function XOLoader() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 2;
    const s = 100; // Canvas logical size
    canvas.width = s * dpr;
    canvas.height = s * dpr;
    canvas.style.width = `${s}px`;
    canvas.style.height = `${s}px`;
    ctx.scale(dpr, dpr);

    // Build letter paths
    const xCenter = s * 0.28;
    const oCenter = s * 0.72;
    const letterY = s * 0.5;
    const armLen = s * 0.16;
    const oRadius = s * 0.17;

    const xPath: [number, number][] = [
      [xCenter - armLen, letterY - armLen],
      [xCenter, letterY],
      [xCenter + armLen, letterY + armLen],
      [xCenter, letterY],
      [xCenter + armLen, letterY - armLen],
      [xCenter, letterY],
      [xCenter - armLen, letterY + armLen],
      [xCenter, letterY],
    ];

    const oPoints = 48;
    const oPath: [number, number][] = [];
    for (let i = 0; i <= oPoints; i++) {
      const angle = (i / oPoints) * Math.PI * 2 - Math.PI / 2;
      oPath.push([
        oCenter + Math.cos(angle) * oRadius,
        letterY + Math.sin(angle) * oRadius,
      ]);
    }

    const fullPath = [...xPath, ...oPath];
    const totalPoints = fullPath.length;

    function getPoint(index: number): [number, number] {
      const i = ((Math.floor(index) % totalPoints) + totalPoints) % totalPoints;
      const next = (i + 1) % totalPoints;
      const t = ((index % 1) + 1) % 1;
      return [
        fullPath[i][0] + (fullPath[next][0] - fullPath[i][0]) * t,
        fullPath[i][1] + (fullPath[next][1] - fullPath[i][1]) * t,
      ];
    }

    let progress = 0;
    const speed = 0.10;
    const fillLength = 20;
    let frame: number;

    function draw() {
      ctx.clearRect(0, 0, s, s);

      // Dim base letters
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(xCenter - armLen, letterY - armLen);
      ctx.lineTo(xCenter + armLen, letterY + armLen);
      ctx.moveTo(xCenter + armLen, letterY - armLen);
      ctx.lineTo(xCenter - armLen, letterY + armLen);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(oCenter, letterY, oRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Smooth fill trail
      for (let i = 0; i < fillLength; i++) {
        const idx = progress - i * 0.5;
        if (idx < 0) continue;
        const [x1, y1] = getPoint(idx);
        const [x2, y2] = getPoint(idx + 0.5);
        const alpha = 1 - i / fillLength;

        // Shadow/depth layer (offset down slightly)
        ctx.beginPath();
        ctx.moveTo(x1, y1 + 0.5);
        ctx.lineTo(x2, y2 + 0.5);
        ctx.strokeStyle = `rgba(40, 80, 160, ${alpha * 0.4})`;
        ctx.lineWidth = 5.5;
        ctx.lineCap = "round";
        ctx.stroke();

        // Main blue stroke
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(100, 149, 237, ${alpha * 0.85})`;
        ctx.lineWidth = 4.5;
        ctx.lineCap = "round";
        ctx.stroke();

        // Top highlight (lighter, thinner)
        ctx.beginPath();
        ctx.moveTo(x1, y1 - 0.5);
        ctx.lineTo(x2, y2 - 0.5);
        ctx.strokeStyle = `rgba(170, 200, 255, ${alpha * 0.5})`;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.stroke();
      }

      progress += speed;
      if (progress >= totalPoints) progress -= totalPoints;

      frame = requestAnimationFrame(draw);
    }

    draw();

    return () => cancelAnimationFrame(frame);
  }, []);

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
      <canvas ref={canvasRef} />
    </div>
  );
}
