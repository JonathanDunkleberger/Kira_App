"use client";

import { useEffect, useRef } from "react";

export default function XOLoader() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 2;
    const size = 80;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    // Letter geometry
    const xCenter = 22;
    const oCenter = 58;
    const letterY = 40;
    const armLen = 14;

    // X path: trace all 4 arms as one continuous path (star pattern)
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

    // O path: circle as series of points
    const oRadius = 14;
    const oPoints = 40;
    const oPath: [number, number][] = [];
    for (let i = 0; i <= oPoints; i++) {
      const angle = (i / oPoints) * Math.PI * 2 - Math.PI / 2;
      oPath.push([
        oCenter + Math.cos(angle) * oRadius,
        letterY + Math.sin(angle) * oRadius,
      ]);
    }

    // Combined path: x then o
    const fullPath = [...xPath, ...oPath];
    const totalPoints = fullPath.length;

    const trailLength = 16;
    let progress = 0;
    const speed = 0.12;

    function getPointOnPath(index: number): [number, number] {
      const i = Math.floor(index) % totalPoints;
      const next = (i + 1) % totalPoints;
      const t = index % 1;
      return [
        fullPath[i][0] + (fullPath[next][0] - fullPath[i][0]) * t,
        fullPath[i][1] + (fullPath[next][1] - fullPath[i][1]) * t,
      ];
    }

    let frame: number;

    function draw() {
      ctx.clearRect(0, 0, size, size);

      // Draw dim base letters
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";

      // Draw X
      ctx.beginPath();
      ctx.moveTo(xCenter - armLen, letterY - armLen);
      ctx.lineTo(xCenter + armLen, letterY + armLen);
      ctx.moveTo(xCenter + armLen, letterY - armLen);
      ctx.lineTo(xCenter - armLen, letterY + armLen);
      ctx.stroke();

      // Draw O
      ctx.beginPath();
      ctx.arc(oCenter, letterY, oRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Draw shooting star trail
      for (let i = 0; i < trailLength; i++) {
        const idx = progress - i * 0.5;
        if (idx < 0) continue;
        const [px, py] = getPointOnPath(idx);
        const alpha = 1 - i / trailLength;
        const radius = 2.5 * (1 - i / trailLength) + 0.5;

        // Glow
        ctx.beginPath();
        ctx.arc(px, py, radius + 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(100, 149, 237, ${alpha * 0.3})`;
        ctx.fill();

        // Core
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
        ctx.fill();
      }

      // Lit-up segment of the letter path behind the star
      for (let i = 0; i < 6; i++) {
        const idx = progress - i * 0.5;
        if (idx < 0) continue;
        const [px, py] = getPointOnPath(idx);
        const nextIdx = idx + 0.5;
        const [nx, ny] = getPointOnPath(nextIdx);
        const a = 0.6 - i * 0.1;

        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(nx, ny);
        ctx.strokeStyle = `rgba(100, 149, 237, ${Math.max(a, 0)})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      progress += speed;
      if (progress >= totalPoints) progress = 0;

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
