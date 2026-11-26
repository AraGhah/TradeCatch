/**
 * Lightweight className joiner. Avoids a clsx/tailwind-merge dependency for
 * the few UI primitives that need conditional classes.
 */
export function cn(
  ...inputs: Array<string | false | null | undefined | 0>
): string {
  return inputs.filter(Boolean).join(" ");
}
