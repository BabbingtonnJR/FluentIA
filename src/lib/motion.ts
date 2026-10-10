/** True when the user asked the OS for less motion; animations should jump to their end state. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Resolves after `ms`, or immediately when reduced motion is on, so exit animations never block input. */
export function afterMotion(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 0 : ms));
}
