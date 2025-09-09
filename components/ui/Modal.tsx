'use client';
import { motion, AnimatePresence } from 'framer-motion';
import React from 'react';

type ModalProps = {
  open: boolean;
  onClose?: () => void;
  title: string;
  description?: string | React.ReactNode;
  children?: React.ReactNode;   // body slot
  footer?: React.ReactNode;     // actions slot
};

export default function Modal({ open, onClose, title, description, children, footer }: ModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100]">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {/* Card */}
          <motion.div
            role="dialog" aria-modal="true"
            className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.6 }}
          >
            <div className="rounded-2xl border bg-white shadow-xl">
              {/* Accent bar */}
              <div className="h-1.5 w-full rounded-t-2xl bg-gradient-to-r from-black via-neutral-700 to-black" />
              <div className="p-5">
                <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
                {description ? (
                  <p className="mt-1.5 text-sm leading-6 text-neutral-600">{description}</p>
                ) : null}
                {children ? <div className="mt-4">{children}</div> : null}
                {footer ? <div className="mt-5 flex items-center justify-end gap-2">{footer}</div> : null}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
