import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../cn';

export const buttonVariants = cva(
  'inline-flex min-h-tap items-center justify-center gap-2 rounded-xl px-4 text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-brand-600 text-white hover:bg-brand-700',
        secondary:
          'border border-line bg-surface-raised text-ink hover:bg-brand-50 dark:hover:bg-surface',
        ghost: 'text-ink hover:bg-brand-50 dark:hover:bg-surface-raised',
        danger: 'bg-danger text-white',
      },
      size: { md: '', lg: 'min-h-12 px-6 text-lg', full: 'w-full' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
