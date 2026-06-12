// Box-Muller transform for Gaussian (normal) distribution
// Humans pause "around N seconds" with variance, not uniformly from min to max
function gaussianRandom(mean: number, stdDev: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stdDev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export async function gaussianDelay(minMs: number, maxMs: number): Promise<void> {
  const mean = (minMs + maxMs) / 2;
  const stdDev = (maxMs - minMs) / 6; // 99.7% of values within [min, max]
  const delay = Math.max(minMs, Math.min(maxMs, gaussianRandom(mean, stdDev)));
  await new Promise(r => setTimeout(r, Math.round(delay)));
}

// NOTE: humanMouseMove / humanType / humanScroll (Playwright-driven) were removed
// in Phase 1 (ADR-001). Human-like interaction now lives in the Chrome extension's
// content.js. The backend only computes human-like *delays* between queued tasks.

export async function actionDelay(): Promise<void> {
  const { SAFE_LIMITS } = await import('./delays');
  await gaussianDelay(SAFE_LIMITS.betweenActions.min, SAFE_LIMITS.betweenActions.max);
}

export async function leadDelay(): Promise<void> {
  const { SAFE_LIMITS } = await import('./delays');
  await gaussianDelay(SAFE_LIMITS.betweenLeads.min, SAFE_LIMITS.betweenLeads.max);
}
