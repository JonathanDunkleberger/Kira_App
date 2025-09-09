"use client";
import * as React from 'react';
import { clsx } from 'clsx';

export interface RatingProps {
  max?: number;
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  readOnly?: boolean;
  className?: string;
  label?: string;
}

export function Rating({
  max = 5,
  value: valueProp,
  defaultValue = 0,
  onChange,
  readOnly,
  className,
  label = 'Rating',
}: RatingProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  const value = valueProp ?? uncontrolled;
  const [hover, setHover] = React.useState<number | null>(null);

  function setValue(next: number) {
    if (readOnly) return;
    if (valueProp == null) setUncontrolled(next);
    onChange?.(next);
  }

  return (
    <div className={clsx('flex items-center gap-1', className)} aria-label={label} role="radiogroup">
      {Array.from({ length: max }).map((_, i) => {
        const starValue = i + 1;
        const active = hover != null ? starValue <= hover : starValue <= value;
        return (
          <Star
            key={starValue}
            filled={active}
            value={starValue}
            onSelect={() => setValue(starValue)}
            onHover={(h) => setHover(h ? starValue : null)}
            readOnly={!!readOnly}
          />
        );
      })}
    </div>
  );
}

function Star({
  filled,
  value,
  onSelect,
  onHover,
  readOnly,
}: {
  filled: boolean;
  value: number;
  onSelect: () => void;
  onHover: (hovering: boolean) => void;
  readOnly: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={filled}
      aria-label={`${value} star${value === 1 ? '' : 's'}`}
      tabIndex={0}
      disabled={readOnly}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      className={clsx(
        'h-6 w-6 flex items-center justify-center rounded-md transition',
        filled ? 'text-pistachio-400' : 'text-cream-400/30 hover:text-cream-300/70',
      )}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className={clsx('h-5 w-5 drop-shadow', filled && 'animate-scale-in')}
      >
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81H7.03a1 1 0 00.95-.69l1.07-3.292z" />
      </svg>
    </button>
  );
}
