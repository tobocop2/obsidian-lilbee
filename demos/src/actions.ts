/**
 * Action handlers. Each one performs a side-effect on the connected
 * Obsidian instance (Playwright CDP) and returns the click-target's
 * viewport coordinates so the HTML encoder can animate a cursor to it.
 *
 * Returning ``null`` from a handler means "no cursor target" -- the
 * synthetic cursor stays where it was for that beat (e.g. for waits
 * and sleeps).
 */
import type { Page } from "playwright";

import type { Action } from "./lib.ts";

export type Coord = { x: number; y: number };

const SETTINGS_SCROLLER = ".vertical-tab-content";

export async function executeAction(page: Page, action: Action): Promise<Coord | null> {
  switch (action.kind) {
    case "clickRibbon":
      return clickRibbon(page, action.target);
    case "clickSelector":
      return clickSelectorReal(page, action.selector);
    case "openSettings":
      return openSettings(page);
    case "settingsScrollTo":
      return settingsScrollTo(page, action.anchor);
    case "executeCommand":
      return executeCommand(page, action.commandId);
    case "fillChat":
      return fillChat(page, action.text);
    case "clickSend":
      return clickSelectorReal(page, ".lilbee-chat-send");
    case "clickChip":
      return clickChip(page, action.index);
    case "type":
      await page.keyboard.type(action.text, { delay: 28 });
      return null;
    case "key":
      await page.keyboard.press(action.key);
      return null;
    case "sleep":
      await page.waitForTimeout(action.ms);
      return null;
    case "waitForSelector":
      await page.waitForSelector(action.selector, { timeout: 60000 });
      return null;
    case "waitChatIdle":
      await waitChatIdle(page, action.maxMs);
      return null;
    case "screenshot":
      return null;
    case "runJs":
      // Wrap so storyboard JS can use top-level await freely.
      await page.evaluate(`(async () => {\n${action.js}\n})()`);
      return null;
  }
}

async function clickRibbon(page: Page, target: "chat" | "tasks"): Promise<Coord> {
  const label = target === "chat" ? "Open lilbee chat" : "Open lilbee Task Center";
  const selector = `[aria-label="${label}"]`;
  return clickSelectorReal(page, selector);
}

async function clickSelectorReal(page: Page, selector: string): Promise<Coord> {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: "visible", timeout: 15000 });
  const box = await loc.boundingBox();
  if (!box) throw new Error(`Selector has no bounding box: ${selector}`);
  const coord = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await loc.evaluate((el: Element) => (el as HTMLElement).click());
  return coord;
}

async function openSettings(page: Page): Promise<Coord> {
  await page.evaluate(() => {
    const app = (globalThis as unknown as { app: { commands: { executeCommandById: (id: string) => void } } }).app;
    app.commands.executeCommandById("app:open-settings");
  });
  await page.waitForSelector(".modal-container", { timeout: 5000 });
  // Click the lilbee tab in the settings sidebar so subsequent scrolls land in the right pane.
  return clickSelectorReal(page, '.vertical-tab-nav-item:has-text("lilbee")');
}

async function settingsScrollTo(page: Page, anchor: string): Promise<Coord | null> {
  const landed = await page.evaluate(
    ([scrollerSel, anchorText]) => {
      const scroller = document.querySelector(scrollerSel as string) as HTMLElement | null;
      if (!scroller) return false;
      const candidates = scroller.querySelectorAll("h1, h2, h3, .setting-item-name, summary");
      for (const el of Array.from(candidates)) {
        const text = (el as HTMLElement).innerText.trim().toLowerCase();
        if (text.startsWith((anchorText as string).toLowerCase())) {
          const r = (el as HTMLElement).getBoundingClientRect();
          const sr = scroller.getBoundingClientRect();
          const absoluteTarget = scroller.scrollTop + (r.top - sr.top) - 40;
          scroller.scrollTo({ top: absoluteTarget, behavior: "smooth" });
          return true;
        }
      }
      return false;
    },
    [SETTINGS_SCROLLER, anchor] as const,
  );
  if (!landed) return null;
  // Wait long enough for smooth scroll to settle, then verify scrollTop stopped changing.
  await waitForScrollSettle(page);
  return null;
}

async function waitChatIdle(page: Page, maxMs: number): Promise<void> {
  const deadline = Date.now() + maxMs;
  // Wait for the Send button to show 'Stop' (streaming started), then back to 'Send' (streaming done).
  let sawStop = false;
  while (Date.now() < deadline) {
    const text = await page.evaluate(
      () => (document.querySelector(".lilbee-chat-send") as HTMLElement | null)?.textContent ?? "",
    );
    if (text.includes("Stop")) sawStop = true;
    if (sawStop && text.includes("Send")) return;
    await page.waitForTimeout(250);
  }
}

async function waitForScrollSettle(page: Page): Promise<void> {
  const deadline = Date.now() + 2000;
  let last = -1;
  while (Date.now() < deadline) {
    const cur = await page.evaluate(
      (sel) => (document.querySelector(sel as string) as HTMLElement | null)?.scrollTop ?? 0,
      SETTINGS_SCROLLER,
    );
    if (cur === last) return;
    last = cur;
    await page.waitForTimeout(120);
  }
}

async function executeCommand(page: Page, commandId: string): Promise<null> {
  await page.evaluate((id) => {
    const app = (globalThis as unknown as { app: { commands: { executeCommandById: (id: string) => void } } }).app;
    app.commands.executeCommandById(id);
  }, commandId);
  return null;
}

async function fillChat(page: Page, text: string): Promise<Coord> {
  const textarea = page.locator("textarea.lilbee-chat-textarea").first();
  await textarea.waitFor({ state: "visible", timeout: 15000 });
  const box = await textarea.boundingBox();
  if (!box) throw new Error("chat textarea has no bounding box");
  await textarea.focus();
  await textarea.fill(text);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function clickChip(page: Page, index: number): Promise<Coord> {
  // Force any source-list <details> open so chips are reachable.
  await page.evaluate(() => {
    document.querySelectorAll(".lilbee-chat-sources details, .lilbee-chat-sources").forEach((el) => {
      const d = el as HTMLDetailsElement;
      if (d.tagName === "DETAILS") d.open = true;
    });
  });
  const chips = page.locator(".lilbee-source-chip-loc");
  const chip = chips.nth(index);
  await chip.waitFor({ state: "visible", timeout: 10000 });
  const box = await chip.boundingBox();
  if (!box) throw new Error(`chip ${index} has no bounding box`);
  await chip.evaluate((el: Element) => (el as HTMLElement).click());
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
