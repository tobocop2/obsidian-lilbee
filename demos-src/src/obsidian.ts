/**
 * Obsidian CDP helpers.
 *
 * One connection per harness run. Returns the live Obsidian page so
 * the rest of the harness can evaluate JS in the renderer (resolve
 * selectors, run commands, dismiss modals, etc.).
 */
import { type Browser, chromium, type Page } from "playwright";

const CDP_URL = "http://localhost:9222";

export type ObsidianContext = {
  browser: Browser;
  page: Page;
  /** Top-left of the Obsidian window in screen logical points. */
  windowOrigin: { x: number; y: number };
};

export async function connectObsidian(vaultMatch?: string): Promise<ObsidianContext> {
  const browser = await chromium.connectOverCDP(CDP_URL);
  // When more than one Obsidian window is open (e.g. the demo vault plus the
  // firststart vault), vaultMatch picks the window whose vault path contains
  // the substring. Without it, take the first Obsidian window.
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      const title = await page.title();
      if (!title.includes("Obsidian")) continue;
      if (vaultMatch) {
        const basePath = await page
          .evaluate(() => (globalThis as unknown as { app?: { vault?: { adapter?: { basePath?: string } } } }).app?.vault?.adapter?.basePath ?? "")
          .catch(() => "");
        if (!basePath.includes(vaultMatch)) continue;
      }
      const windowOrigin = await page.evaluate(() => ({ x: window.screenX, y: window.screenY }));
      return { browser, page, windowOrigin };
    }
  }
  await browser.close();
  throw new Error(
    vaultMatch
      ? `No Obsidian window for vault matching "${vaultMatch}" found on CDP. Open that vault (remote-debugging on 9222).`
      : "No Obsidian window found on CDP. Launch with --remote-debugging-port=9222.",
  );
}

/** Resolve a CSS selector to a screen-coord click target.
 *
 * textIs (exact match) or textHas (substring) narrow the matches by visible
 * text content. Match the first viewport-visible element so virtualised
 * trees don't trip us up. */
export async function resolveSelector(
  ctx: ObsidianContext,
  selector: string,
  options: { textIs?: string; textHas?: string } = {},
): Promise<{ x: number; y: number } | null> {
  const box = await ctx.page.evaluate(
    ([sel, textIs, textHas]) => {
      const matches = Array.from(document.querySelectorAll(sel as string));
      let el: Element | null = null;
      if (textIs) {
        el = matches.find((m) => (m as HTMLElement).innerText?.trim() === textIs) ?? null;
      } else if (textHas) {
        const needle = (textHas as string).toLowerCase();
        el = matches.find((m) => ((m as HTMLElement).innerText ?? "").toLowerCase().includes(needle)) ?? null;
      } else {
        el = matches[0] ?? null;
      }
      if (!el) return null;
      const r = (el as HTMLElement).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    [selector, options.textIs ?? null, options.textHas ?? null] as const,
  );
  if (!box) return null;
  return {
    x: ctx.windowOrigin.x + box.x,
    y: ctx.windowOrigin.y + box.y,
  };
}

/** Resolve a coord via a custom JS finder. The finder runs in page context. */
export async function resolveByJs(
  ctx: ObsidianContext,
  finder: string,
): Promise<{ x: number; y: number } | null> {
  const wrapped = `(() => {
    const el = (() => { ${finder} })();
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`;
  const box = await ctx.page.evaluate(wrapped);
  if (!box) return null;
  const b = box as { x: number; y: number };
  return { x: ctx.windowOrigin.x + b.x, y: ctx.windowOrigin.y + b.y };
}

/** Get window bounds in logical screen points (for ffmpeg crop). */
export async function getWindowBounds(ctx: ObsidianContext): Promise<{ x: number; y: number; w: number; h: number }> {
  const inner = await ctx.page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  return { x: ctx.windowOrigin.x, y: ctx.windowOrigin.y, w: inner.w, h: inner.h };
}
