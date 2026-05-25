/**
 * Storyboard building blocks. A storyboard is just a typed array of
 * beats; each beat pairs a caption with an action.
 *
 *   import { storyboard, beat, clickRibbon, fillChat, clickSend } from '../src/lib';
 *
 *   export default storyboard('chat', {
 *     window: [1400, 900],
 *     outputs: ['html', 'gif'],
 *     beats: [
 *       beat('Open chat', clickRibbon('chat')),
 *       beat('Ask towing question', fillChat(QUESTION)),
 *       beat('Send', clickSend()),
 *     ],
 *   });
 *
 * The runner loads the module's default export and walks ``beats`` in
 * order. The lib stays small; new actions just need a new ``Action``
 * variant + a handler in actions.ts.
 */

export type Action =
  | { kind: "clickRibbon"; target: "chat" | "tasks" }
  | { kind: "clickSelector"; selector: string }
  | { kind: "rightClickSelector"; selector: string }
  | { kind: "clickMenuItem"; name: string }
  | { kind: "openSettings" }
  | { kind: "settingsScrollTo"; anchor: string }
  | { kind: "executeCommand"; commandId: string }
  | { kind: "fillChat"; text: string }
  | { kind: "clickSend" }
  | { kind: "clickChip"; index: number }
  | { kind: "clickSourceFile"; name: string }
  | { kind: "type"; text: string }
  | { kind: "key"; key: string }
  | { kind: "sleep"; ms: number }
  | { kind: "waitForSelector"; selector: string }
  | { kind: "waitChatIdle"; maxMs: number }
  | { kind: "screenshot" }
  | { kind: "wheelScroll"; selector: string; ticks: number; fast?: boolean }
  | { kind: "runJs"; js: string };

export type Beat = {
  /** Internal label — used in timeline.json and console logs. Not rendered into the video. */
  label: string;
  action: Action;
  /** Post-action hold (default 800 ms). */
  holdMs?: number;
  /** After the action, park the cursor at this viewport-relative coord. */
  cursorParkTo?: [number, number];
  /** For typing beats, per-character delay (ms). */
  typingMsPerChar?: number;
  /** Post-process speedup factor for this beat. 4 = render 4x faster.
   * While this beat plays, a "Sped up Nx" caption appears top-right. */
  speedup?: number;
  /** Override the runJs abort guard (default 240s) for beats that
   * legitimately run long while the screen keeps changing — e.g. waiting
   * on a real model download to stream to completion. */
  maxMs?: number;
  /** Flash a keyboard-shortcut badge (e.g. "⌘P") at the top of the frame
   * while this beat plays — used on beats that trigger the command palette
   * so viewers see which shortcut opened it. */
  keyHint?: string;
};

import type { LayoutName } from "./layouts.ts";

export type Storyboard = {
  name: string;
  window: { w: number; h: number };
  layout: LayoutName;
  /** Doc names to remove from the corpus before recording (so ingest demos start fresh). */
  freshIngest?: string[];
  /** HF repo of a model to uninstall before recording, so a download demo
   * triggers a real pull on every take. */
  freshModel?: string;
  /** Clear Task Center (cancel active + Clear button) in pre-flight. Defaults to true. */
  clearTaskCenter?: boolean;
  /** Clear chat history in pre-flight. Defaults to true. */
  clearChat?: boolean;
  /** Fire a throwaway chat in pre-flight so the model is warm. Defaults to true. */
  preloadChatModel?: boolean;
  /** Skip the chat-model pin entirely. For demos that don't exercise chat. */
  skipModelPin?: boolean;
  /** Demo runs in a vault without lilbee installed (first_start). Skip pre-flight. */
  noLilbee?: boolean;
  /** When several Obsidian windows are open, pick the one whose vault path
   * contains this substring (first_start records in the firststart vault
   * while the demo vault window is also open). */
  vaultMatch?: string;
  /** Apply a global PTS speedup to the final webm. 2 = 2x faster. */
  postSpeedup?: number;
  /** Optional caption overlay drawn at the top-right of the final webm. */
  caption?: string;
  /** Which beat is the held money shot (gets extra hold). */
  moneyShotBeatIndex?: number;
  /** Cursor home position (viewport-relative coords). Cursor parks here
   * before ffmpeg's first frame, so the opening frame has a known cursor
   * location instead of wherever the cursor happened to be left. */
  cursorHome?: [number, number];
  beats: Beat[];
};

export type StoryboardOptions = {
  window?: [number, number];
  layout?: LayoutName;
  freshIngest?: string[];
  freshModel?: string;
  clearTaskCenter?: boolean;
  clearChat?: boolean;
  preloadChatModel?: boolean;
  skipModelPin?: boolean;
  noLilbee?: boolean;
  vaultMatch?: string;
  postSpeedup?: number;
  caption?: string;
  moneyShotBeatIndex?: number;
  cursorHome?: [number, number];
  beats: Beat[];
};

export function storyboard(name: string, opts: StoryboardOptions): Storyboard {
  return {
    name,
    window: { w: opts.window?.[0] ?? 1400, h: opts.window?.[1] ?? 900 },
    layout: opts.layout ?? "chat-and-tasks",
    freshIngest: opts.freshIngest,
    freshModel: opts.freshModel,
    clearTaskCenter: opts.clearTaskCenter,
    clearChat: opts.clearChat,
    preloadChatModel: opts.preloadChatModel,
    skipModelPin: opts.skipModelPin,
    noLilbee: opts.noLilbee,
    vaultMatch: opts.vaultMatch,
    postSpeedup: opts.postSpeedup,
    caption: opts.caption,
    moneyShotBeatIndex: opts.moneyShotBeatIndex,
    cursorHome: opts.cursorHome,
    beats: opts.beats,
  };
}

export function beat(
  label: string,
  action: Action,
  options: {
    holdMs?: number;
    cursorParkTo?: [number, number];
    speedup?: number;
    maxMs?: number;
    keyHint?: string;
  } = {},
): Beat {
  return {
    label,
    action,
    holdMs: options.holdMs,
    cursorParkTo: options.cursorParkTo,
    speedup: options.speedup,
    maxMs: options.maxMs,
    keyHint: options.keyHint,
  };
}

// --- action factories ------------------------------------------------

export const clickRibbon = (target: "chat" | "tasks"): Action => ({ kind: "clickRibbon", target });
export const clickSelector = (selector: string): Action => ({ kind: "clickSelector", selector });
export const rightClickSelector = (selector: string): Action => ({ kind: "rightClickSelector", selector });
export const clickMenuItem = (name: string): Action => ({ kind: "clickMenuItem", name });
export const openSettings = (): Action => ({ kind: "openSettings" });
export const settingsScrollTo = (anchor: string): Action => ({ kind: "settingsScrollTo", anchor });
export const command = (commandId: string): Action => ({ kind: "executeCommand", commandId });
export const fillChat = (text: string): Action => ({ kind: "fillChat", text });
export const clickSend = (): Action => ({ kind: "clickSend" });
export const clickChip = (index: number): Action => ({ kind: "clickChip", index });
/** Click the location chip of the cited source whose filename contains `name`.
 * Use when the answer cites a specific document that isn't the first source —
 * clickChip(0) would open whatever ranked first, not the cited file. */
export const clickSourceFile = (name: string): Action => ({ kind: "clickSourceFile", name });
export const type_ = (text: string): Action => ({ kind: "type", text });
export const key = (k: string): Action => ({ kind: "key", key: k });
export const sleep = (ms: number): Action => ({ kind: "sleep", ms });
export const waitForSelector = (selector: string): Action => ({ kind: "waitForSelector", selector });
export const waitChatIdle = (maxMs = 90_000): Action => ({ kind: "waitChatIdle", maxMs });
export const screenshot = (): Action => ({ kind: "screenshot" });
/** Move the OS cursor over the resolved selector, then drive real mouse-wheel ticks.
 * `ticks` is the same convention as pyautogui.scroll: positive = up, negative = down.
 * `fast` uses larger bursts / shorter pauses — a quick flick through a long list. */
export const wheelScroll = (selector: string, ticks: number, fast = false): Action => ({
  kind: "wheelScroll",
  selector,
  ticks,
  fast,
});
export const runJs = (js: string): Action => ({ kind: "runJs", js });
