import { Suspense } from 'react';
import MarionetteApp from '@/components/marionette/MarionetteApp';

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <MarionetteApp />
    </Suspense>
  );
}
