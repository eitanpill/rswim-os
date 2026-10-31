'use client';

import type { ReactNode } from 'react';

/** A GET form that applies itself as soon as a filter changes; its submit button stays for typing a search. */
export function FilterForm({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <form
      className={className}
      role="search"
      onChange={(e) => {
        if ((e.target as HTMLElement).tagName === 'SELECT') e.currentTarget.requestSubmit();
      }}
    >
      {children}
    </form>
  );
}
