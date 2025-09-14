import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pistachio-400 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[.98]',
  {
    variants: {
      variant: {
        primary:
          'bg-pistachio-500 text-bg hover:bg-pistachio-400 shadow-sm shadow-pistachio-900/40',
        secondary: 'bg-surface-300 text-cream-100 hover:bg-surface-400 border border-white/10',
        ghost: 'bg-transparent text-cream-300 hover:bg-surface-300/40 border border-transparent',
        subtle: 'bg-surface-200 text-cream-200 hover:bg-surface-300 border border-surface-300',
        destructive: 'bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-400',
        outline: 'border border-cream-300/20 bg-transparent text-cream-200 hover:bg-cream-200/5',
        default: 'bg-bg text-cream-100 border border-white/10 hover:bg-surface-300/60',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={clsx(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
