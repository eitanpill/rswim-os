import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../cn';

export const buttonVariants = cva(
  'inline-flex min-h-tap items-center justify-center gap-2 rounded-xl px-4 text-base font-medium transition-[background-color,box-shadow,transform,color] duration-150 select-none active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-brand-600 text-white shadow-[0_6px_16px_-8px_var(--color-brand-600)] hover:bg-brand-700',
        secondary:
          'border border-line bg-surface-raised text-ink hover:border-brand-500 hover:bg-brand-50 dark:hover:bg-surface',
        soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-surface dark:text-brand-500',
        ghost: 'text-ink hover:bg-brand-50 dark:hover:bg-surface-raised',
        danger: 'bg-danger text-white',
        onWater:
          'bg-white/95 text-brand-700 shadow-[0_6px_16px_-8px_rgb(0_0_0/0.4)] hover:bg-white',
      },
      size: {
        md: '',
        sm: 'min-h-9 rounded-lg px-3 text-sm',
        lg: 'min-h-12 px-6 text-lg',
        full: 'w-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
