import React from 'react';

export default function MicButton() {
  return (
    <button
      className="relative inline-flex items-center justify-center h-40 w-40 rounded-full text-white text-lg font-semibold text-center leading-snug select-none"
      style={{
        background: 'radial-gradient(circle, #d8b4fe, #7e22ce)',
        boxShadow: '0 0 50px #a855f7, 0 0 20px #a855f7 inset',
      }}
    >
      Start Conversation
    </button>
  );
}
