import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn('rounded-card border border-line bg-surface-raised p-4 shadow-sm', className)}
      {...props}
    />
  );
}

export function CardTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <header className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">{children}</h2>
      {aside}
    </header>
  );
}
