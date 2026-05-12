import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

const SESSION_DIR = path.join(process.cwd(), '..', 'data', 'sessions');
const SESSION_FILE = path.join(SESSION_DIR, 'linkedin.json');

if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Stable fingerprint — never change once first session is created
const BROWSER_CONFIG = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1366, height: 768 },
  locale: 'en-US',
  timezoneId: 'America/New_York',
  args: [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
  ],
  // Mask automation signals
  extraHTTPHeaders: {
    'Accept-Language': 'en-US,en;q=0.9',
  },
} as const;

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;

export async function getBrowser(): Promise<BrowserContext> {
  if (_context) return _context;

  _browser = await chromium.launch({
    headless: true,
    args: [...BROWSER_CONFIG.args],
  });

  _context = await _browser.newContext({
    userAgent: BROWSER_CONFIG.userAgent,
    viewport: BROWSER_CONFIG.viewport,
    locale: BROWSER_CONFIG.locale,
    timezoneId: BROWSER_CONFIG.timezoneId,
    extraHTTPHeaders: BROWSER_CONFIG.extraHTTPHeaders,
  });

  // Mask navigator.webdriver
  await _context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });

  return _context;
}

export async function closeBrowser(): Promise<void> {
  if (_context) { await _context.close(); _context = null; }
  if (_browser) { await _browser.close(); _browser = null; }
}

export function saveSession(cookies: Parameters<BrowserContext['addCookies']>[0]): void {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
  logger.info('Session saved');
}

export function loadSession(): Parameters<BrowserContext['addCookies']>[0] | null {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

export async function isSessionActive(): Promise<boolean> {
  const cookies = loadSession();
  if (!cookies) return false;

  try {
    const ctx = await getBrowser();
    await ctx.addCookies(cookies);
    const page = await ctx.newPage();
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const url = page.url();
    await page.close();
    return !url.includes('/login') && !url.includes('/checkpoint');
  } catch {
    return false;
  }
}

export async function startManualLogin(): Promise<void> {
  logger.info('Starting manual login flow (headless:false)');

  const browser = await chromium.launch({
    headless: false,
    args: [...BROWSER_CONFIG.args],
  });

  const ctx = await browser.newContext({
    userAgent: BROWSER_CONFIG.userAgent,
    viewport: BROWSER_CONFIG.viewport,
    locale: BROWSER_CONFIG.locale,
    timezoneId: BROWSER_CONFIG.timezoneId,
  });

  const page = await ctx.newPage();
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

  // Wait until redirected to feed (user completes login manually)
  try {
    await page.waitForURL('**/feed/**', { timeout: 120_000 });
  } catch {
    logger.warn('Login timeout or user closed browser');
    await browser.close();
    return;
  }

  const cookies = await ctx.cookies();
  saveSession(cookies);
  await browser.close();
  logger.info('Manual login complete — session saved');
}
