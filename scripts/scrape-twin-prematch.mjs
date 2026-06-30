#!/usr/bin/env node
/**
 * Twin pre-match tennis scraper — Playwright headless.
 *
 * Substitui o cron TennisStats que falhava regularmente. Single source
 * (mesmo bookmaker que afiliamos) para schedule + odds → o modelo já
 * tem tudo o que precisa para emitir pick com EV calculado.
 *
 * Targets:
 *   - ATP: /bets/tennis/1970324836974594-atp
 *   - WTA: /bets/tennis/1970324836974693-wta
 *
 * Output: JSON array para stdout, postado para Vercel por GHA.
 */
import { chromium } from 'playwright';

const MIRRORS = ['twin225.com', 'twin223.com', 'twin178.com', 'twin232.com'];
const SECTIONS = [
  { tour: 'atp', path: '/bets/tennis/1970324836974594-atp' },
  { tour: 'wta', path: '/bets/tennis/1970324836974693-wta' },
];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function scrapeSection(page, tour, path) {
  let loaded = false;
  for (const host of MIRRORS) {
    try {
      await page.goto(`https://${host}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      loaded = true;
      break;
    } catch (e) {
      console.error(`[twin/${tour}] mirror ${host} fail: ${e.message}`);
    }
  }
  if (!loaded) return [];

  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3500);

  // Cookie banner
  try {
    await page.locator('button:has-text("Aceitar"), button:has-text("Accept")').first().click({ timeout: 1500 });
    await page.waitForTimeout(500);
  } catch {}

  const matches = await page.evaluate((tour) => {
    const cards = [...document.querySelectorAll('[data-test-el="sportline-event-card"][data-test-attr-prematch="true"]')];
    const out = [];
    for (const card of cards) {
      const names = [...card.querySelectorAll('[class*="competitor__name"]')]
        .map(e => (e.textContent || '').trim())
        .filter(Boolean);
      const prices = [...card.querySelectorAll('[data-test-el="sportline-runner-price"]')]
        .map(e => parseFloat((e.textContent || '').trim()))
        .filter(n => isFinite(n) && n >= 1.01 && n <= 50.0);
      if (names.length < 2 || prices.length < 2) continue;

      const tournament = card.querySelector('[class*="championship__name"]')?.textContent?.trim() ?? null;
      const dateTxt = card.querySelector('[class*="kickoff-countdown__date"]')?.textContent?.trim() ?? null;
      const timeTxt = card.querySelector('[class*="kickoff-countdown__time"]')?.textContent?.trim() ?? null;
      const href = card.querySelector('a[href*="/bets/tennis/"]')?.getAttribute('href') ?? null;

      out.push({
        tour,
        tournament,
        name_a: names[0],
        name_b: names[1],
        odd_a: prices[0],
        odd_b: prices[1],
        kickoff_date_text: dateTxt,
        kickoff_time_text: timeTxt,
        twin_href: href,
      });
    }
    return out;
  }, tour);

  console.error(`[twin/${tour}] extracted ${matches.length} pre-match`);
  return matches;
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    locale: 'pt-PT',
    extraHTTPHeaders: { 'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8' },
  });
  const page = await ctx.newPage();

  const all = [];
  for (const s of SECTIONS) {
    const m = await scrapeSection(page, s.tour, s.path);
    all.push(...m);
  }

  console.error(`[twin] total ${all.length} pre-match (ATP + WTA)`);
  console.log(JSON.stringify({ source: 'twin', captured_at: new Date().toISOString(), matches: all }));

  await browser.close();
}

main().catch(e => { console.error('[twin] fatal:', e); process.exit(1); });
