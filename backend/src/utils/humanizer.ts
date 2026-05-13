import { Page, ElementHandle } from 'playwright';

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

// Bezier Curve Mouse Movement
// Movement along a Bezier curve through 5-10 intermediate points — natural mouse motion

interface Point { x: number; y: number }

function bezierPoint(t: number, points: Point[]): Point {
  if (points.length === 1) return points[0];
  const newPoints: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    newPoints.push({
      x: (1 - t) * points[i].x + t * points[i + 1].x,
      y: (1 - t) * points[i].y + t * points[i + 1].y,
    });
  }
  return bezierPoint(t, newPoints);
}

function generateBezierPath(from: Point, to: Point, numControlPoints = 3): Point[] {
  const controls: Point[] = [from];
  for (let i = 0; i < numControlPoints; i++) {
    controls.push({
      x: from.x + (to.x - from.x) * (i + 1) / (numControlPoints + 1) + (Math.random() - 0.5) * 100,
      y: from.y + (to.y - from.y) * (i + 1) / (numControlPoints + 1) + (Math.random() - 0.5) * 100,
    });
  }
  controls.push(to);
  return controls;
}

export async function humanMouseMove(page: Page, target: ElementHandle): Promise<void> {
  const box = await target.boundingBox();
  if (!box) return;

  const targetX = box.x + box.width / 2 + (Math.random() - 0.5) * 10;
  const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * 10;

  const viewport = page.viewportSize() || { width: 1366, height: 768 };
  const fromX = viewport.width / 2 + (Math.random() - 0.5) * 200;
  const fromY = viewport.height / 2 + (Math.random() - 0.5) * 200;

  const numSteps = 5 + Math.floor(Math.random() * 6); // 5-10 steps
  const controlPoints = generateBezierPath({ x: fromX, y: fromY }, { x: targetX, y: targetY });

  for (let i = 0; i <= numSteps; i++) {
    const t = i / numSteps;
    const point = bezierPoint(t, controlPoints);
    await page.mouse.move(point.x, point.y);
    await new Promise(r => setTimeout(r, 10 + Math.random() * 30));
  }
}

// Human Typing
// Per-character input with variable speed and occasional mistakes
// NOTE: intentionally does NOT use page.fill() — fill() doesn't simulate real input

export async function humanType(page: Page, element: ElementHandle, text: string): Promise<void> {
  await element.click();
  await gaussianDelay(200, 500);

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // ~3% chance of typo for long texts, alphabetic characters only
    const shouldMistake = text.length > 20 && Math.random() < 0.03 && /[a-zA-Z]/.test(char);

    if (shouldMistake) {
      const mistakeChar = String.fromCharCode(char.charCodeAt(0) + (Math.random() < 0.5 ? 1 : -1));
      await page.keyboard.type(mistakeChar);
      await gaussianDelay(100, 300);
      await page.keyboard.press('Backspace');
      await gaussianDelay(150, 400);
    }

    await page.keyboard.type(char);

    // Numbers and punctuation typed slightly slower
    const baseDelay = /[0-9.,!?]/.test(char) ? 100 : 60;
    const maxDelay = /[0-9.,!?]/.test(char) ? 250 : 180;
    await gaussianDelay(baseDelay, maxDelay);

    // Occasional pause after space (thinking between words)
    if (char === ' ' && Math.random() < 0.2) {
      await gaussianDelay(200, 600);
    }
  }
}

// Human Scroll
// Scroll down-up before each action — simulates reading the page

export async function humanScroll(page: Page): Promise<void> {
  const numScrolls = 2 + Math.floor(Math.random() * 4); // 2-5 scrolls

  for (let i = 0; i < numScrolls; i++) {
    const scrollDown = Math.random() < 0.8; // mostly down
    const amount = 100 + Math.random() * 300;

    await page.mouse.wheel(0, scrollDown ? amount : -amount / 2);
    await gaussianDelay(300, 800);
  }

  // Sometimes scroll back up a bit
  if (Math.random() < 0.4) {
    await page.mouse.wheel(0, -(50 + Math.random() * 150));
    await gaussianDelay(200, 500);
  }
}

export async function actionDelay(): Promise<void> {
  const { SAFE_LIMITS } = await import('./delays');
  await gaussianDelay(SAFE_LIMITS.betweenActions.min, SAFE_LIMITS.betweenActions.max);
}

export async function leadDelay(): Promise<void> {
  const { SAFE_LIMITS } = await import('./delays');
  await gaussianDelay(SAFE_LIMITS.betweenLeads.min, SAFE_LIMITS.betweenLeads.max);
}
