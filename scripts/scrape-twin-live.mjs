#!/usr/bin/env node
/**
 * Twin live tennis scraper — Playwright headless.
 *
 * Strategy:
 *   1. Launch chromium with realistic UA + viewport
 *   2. Navigate twin225.com/live/tennis (with fallback mirrors)
 *   3. Wait for hydration: aceitar cookies, esperar selectores de odds
 *   4. Defensive extraction: tenta múltiplas strategies para encontrar
 *      pares de players + odds; usa heurísticas baseadas em proximidade
 *      DOM e formato de texto (X.XX)
 *   5. Output JSON array para stdout — GHA pickup + POST para Vercel
 *
 * Debug: se Twin mudar layout, o script grava screenshot + HTML para
 * troubleshoot em GHA artifacts.
 *
 * Uso: node scripts/scrape-twin-live.mjs > out.json
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const MIRRORS = [
  'https://twin225.com/live/tennis',
  'https://twin223.com/live/tennis',
  'https://twin178.com/live/tennis',
  'https://twin232.com/live/tennis',
];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT_MS = 45000;

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    locale: 'pt-PT',
    extraHTTPHeaders: { 'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8' },
  });
  const page = await ctx.newPage();

  let loaded = false;
  let lastErr = null;
  for (const url of MIRRORS) {
    try {
      console.error(`[twin] trying ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
      loaded = true;
      break;
    } catch (e) {
      lastErr = e;
      console.error(`[twin] fail ${url}: ${e.message}`);
    }
  }
  if (!loaded) {
    console.error('[twin] all mirrors failed:', lastErr?.message);
    await browser.close();
    process.exit(1);
  }

  // Wait for SPA hydration. Twin loads chunks dynamically.
  await page.waitForLoadState('networkidle', { timeout: TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(3000);

  // Try to dismiss cookie banner if present
  try {
    await page.locator('button:has-text("Aceitar"), button:has-text("Accept"), button:has-text("OK")').first().click({ timeout: 2000 });
    await page.waitForTimeout(1000);
  } catch {}

  // Capture DOM for debug if needed
  const debugHtml = await page.content();
  if (process.env.DEBUG_TWIN_DUMP === '1') {
    writeFileSync('/tmp/twin-rendered.html', debugHtml);
    await page.screenshot({ path: '/tmp/twin-rendered.png', fullPage: true });
    console.error('[twin] saved debug to /tmp/twin-rendered.{html,png}');
  }

  // Extraction via data-test selectors (estáveis vs class hashes do build).
  // Twin marca cada card com data-test-el="sportline-event-card" e dentro
  // dele cada runner com data-test="sportline-runner-name|price".
  const matches = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-test-el="sportline-event-card"]'));
    const out = [];
    for (const card of cards) {
      const isLive = card.getAttribute('data-test-attr-live') === 'true';
      if (!isLive) continue;

      const names = Array.from(card.querySelectorAll('[data-test-el="sportline-runner-name"]'))
        .map(el => (el.textContent ?? '').trim())
        .filter(s => s.length > 0);
      const prices = Array.from(card.querySelectorAll('[data-test-el="sportline-runner-price"]'))
        .map(el => parseFloat((el.textContent ?? '').trim()))
        .filter(n => isFinite(n) && n >= 1.01 && n <= 50.0);

      if (prices.length < 2) continue;

      // Nomes dos jogadores: Twin renderiza-os em elementos cujo class
      // contém 'competitor__name' (hash CSS-modules varia por build).
      // Formato: "LastName, FirstName" (mesmo da Sportradar — ideal para matching).
      const competitorEls = Array.from(card.querySelectorAll('[class*="competitor__name"]'));
      const compNames = competitorEls
        .map(el => (el.textContent ?? '').trim())
        .filter(s => s.length > 1);
      if (compNames.length < 2) continue;

      const href = card.querySelector('a[href*="/bets/tennis/"]')?.getAttribute('href') ?? '';

      out.push({
        name_a: compNames[0],
        name_b: compNames[1],
        odd_a: prices[0],
        odd_b: prices[1],
        href,
      });
    }
    return out;
  });

  console.error(`[twin] extracted ${matches.length} potential matches`);
  console.log(JSON.stringify({ source: 'twin', captured_at: new Date().toISOString(), matches }));

  await browser.close();
}

main().catch(e => { console.error('[twin] fatal:', e); process.exit(1); });
