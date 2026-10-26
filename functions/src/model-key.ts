/**
 * The planners' model key. ANTHROPIC_API_KEY is declared with defineSecret in each
 * planner's dependency array, so when it is set Cloud Functions injects it into the
 * environment. Reading the environment directly is the same value; unlike
 * `.value()` it doesn't log a "No value found for secret parameter" warning on every
 * plan when no key is configured — which is the normal, supported state.
 */
export function modelKey(): string {
  return (process.env.ANTHROPIC_API_KEY ?? "").trim();
}
