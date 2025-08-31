'use client';

import { useEffect, useState } from 'react';

export default function WelcomeMessage() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const hasSeenMessage = localStorage.getItem('hasSeenWelcomeMessage');
      if (!hasSeenMessage) {
        const timer = setTimeout(() => {
          setShow(true);
          localStorage.setItem('hasSeenWelcomeMessage', 'true');
        }, 1000);
        return () => clearTimeout(timer);
      }
    } catch {}
  }, []);

  if (!show) return null;

  return (
    <div className="absolute bottom-full mb-2 px-4 py-2 bg-white text-black rounded-lg shadow-lg text-center animate-pulse">
      Click the orb to start talking!
      <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-8 border-x-transparent border-t-8 border-t-white"></div>
    </div>
  );
}
