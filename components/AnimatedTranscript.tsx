"use client";

import { motion } from 'framer-motion';

export function AnimatedMessage({ message, index }: { message: any; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={`p-4 rounded-xl ${
        message.role === 'user'
          ? 'bg-white/5 border border-white/10'
          : 'bg-fuchsia-900/20 border border-fuchsia-700/30'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="font-medium text-sm text-white/80">
          {message.role === 'user' ? 'You' : 'Kira'}
        </span>
        <span className="text-xs text-white/40">
          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <p className="text-white/90 text-sm leading-relaxed">
        {message.content}
      </p>
    </motion.div>
  );
}
