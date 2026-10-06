'use client';

import { Button } from '@rswim/ui';

/** Opens the browser's print dialog (print, or save as PDF). Hidden on the printed page itself. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="secondary" className="print:hidden" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
