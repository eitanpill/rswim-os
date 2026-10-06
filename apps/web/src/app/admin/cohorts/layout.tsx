import type { ReactNode } from 'react';
import { requireFeature } from '@/lib/platform';

export default async function FeatureLayout({ children }: { children: ReactNode }) {
  await requireFeature('courses');
  return children;
}
