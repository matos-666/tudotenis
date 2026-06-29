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

  // Extraction strategy: localizar containers que tenham 2 nomes de jogadores
  // + 2 odds. Heurística baseada em:
  //   - Texto numérico no formato X.XX entre 1.01 e 50.0
  //   - Pares de nomes próximos (mesmo card / linha)
  const matches = await page.evaluate(() => {
    const allEls = Array.from(document.querySelectorAll('*'));
    const candidates = [];

    // Find odd buttons: elements whose direct text is a decimal X.XX
    const oddRe = /^\s*(\d+\.\d{2})\s*$/;
    const oddElements = [];
    for (const el of allEls) {
      if (el.childNodes.length === 1 && el.firstChild?.nodeType === 3) {
        const t = el.textContent?.trim() ?? '';
        const m = oddRe.exec(t);
        if (m) {
          const v = parseFloat(m[1]);
          if (v >= 1.01 && v <= 50.0) {
            oddElements.push({ el, value: v });
          }
        }
      }
    }

    // Group odd elements by shared ancestor (likely match card).
    // Walk up DOM until we find an ancestor that contains EXACTLY 2 odds
    // and also looks like a card (has player name-ish text).
    const groups = new Map();
    for (const { el, value } of oddElements) {
      let node = el.parentElement;
      let depth = 0;
      while (node && depth < 10) {
        const oddsInside = node.querySelectorAll('*').length;
        if (oddsInside > 2 && oddsInside < 200) {
          // Check if has 2 odds in immediate children/descendants
          const numericTexts = node.innerText?.match(/\b\d+\.\d{2}\b/g) ?? [];
          if (numericTexts.length === 2) {
            if (!groups.has(node)) {
              groups.set(node, { node, odds: [], texts: numericTexts });
            }
            groups.get(node).odds.push(value);
            break;
          }
        }
        node = node.parentElement;
        depth++;
      }
    }

    const out = [];
    for (const [node, info] of groups.entries()) {
      const innerText = node.innerText ?? '';
      // Look for player names: typical pattern is "Player Name1" + "Player Name2"
      // each on their own line, with text length > 4 and contains a space or known characters
      const lines = innerText.split('\n').map(s => s.trim()).filter(Boolean);
      // Names: lines that are NOT numeric and contain letters
      const nameLines = lines.filter(l => /[A-Za-z]{3,}/.test(l) && !/^\d+\.?\d*$/.test(l) && !/^\d+:\d+$/.test(l) && l.length < 60);
      if (nameLines.length < 2) continue;
      const odds = info.texts.map(t => parseFloat(t));
      if (odds.length !== 2 || odds.some(o => !isFinite(o))) continue;
      // Heuristic: first 2 candidate name-like lines are likely the players
      out.push({
        name_a: nameLines[0],
        name_b: nameLines[1],
        odd_a: odds[0],
        odd_b: odds[1],
        all_lines: lines.slice(0, 8), // for debug
      });
    }

    return out;
  });

  console.error(`[twin] extracted ${matches.length} potential matches`);
  console.log(JSON.stringify({ source: 'twin', captured_at: new Date().toISOString(), matches }));

  await browser.close();
}

main().catch(e => { console.error('[twin] fatal:', e); process.exit(1); });
