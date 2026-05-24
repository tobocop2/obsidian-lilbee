/**
 * Demo recorder.
 *
 *   1. preflight() — apply layout, pin model, clear state.
 *   2. Spawn ffmpeg, capture recordingStartTime.
 *   3. Walk beats: log per-beat start/end timestamps; drive the cursor
 *      via pyautogui (cursor.ts); fire Playwright-level actions for
 *      non-cursor things (commands, fills, scrolls, waits).
 *   4. SIGINT ffmpeg, wait for muxer.
 *   5. Trim + crop using recorded timestamps. Re-encode VP9.
 *   6. Emit <name>.webm + <name>.timeline.json + run review.ts.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { clickAtCoord, clickMenuItem, moveToCoord, parkCursor, pressKey, rightClickAtCoord, scrollAt, typeText } from "./cursor.ts";
import { connectObsidian, getWindowBounds, resolveByJs, resolveSelector, type ObsidianContext } from "./obsidian.ts";
import { DEFAULT_MODEL, preflight, restoreVaultFiles } from "./preflight.ts";
import { buildReview } from "./review.ts";
import type { Action, Beat, Storyboard } from "./lib.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "output");

const DEFAULT_LEAD_IN_MS = 1500;
const DEFAULT_TAIL_MS = 1500;
const DEFAULT_HOLD_MS = 800;
const HOVER_BEFORE_CLICK_MS = 350;
// Hard ceiling for a single runJs beat. A storyboard that awaits an
// open SSE stream (e.g. addToLilbee) would otherwise hang forever while
// ffmpeg captures a static screen. If a beat exceeds this, abort the
// recording loudly instead of silently filming nothing.
const RUN_JS_BEAT_TIMEOUT_MS = 240_000;

/** Race a promise against a timeout; reject loudly if it doesn't settle. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`beat '${label}' exceeded ${ms}ms — aborting to avoid filming a static screen`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type BeatRecord = {
  index: number;
  label: string;
  kind: string;
  startedAt: number;
  endedAt: number;
  cursor: { x: number; y: number } | null;
  speedup?: number;
};

export async function record(storyboard: Storyboard): Promise<void> {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const rawPath = join(OUT_DIR, `${storyboard.name}.raw.mp4`);
  const outPath = join(OUT_DIR, `${storyboard.name}.webm`);
  const timelinePath = join(OUT_DIR, `${storyboard.name}.timeline.json`);

  rmSync(rawPath, { force: true });
  rmSync(outPath, { force: true });

  // Tell mouse.py where to log every cursor position it visits, so
  // post-processing can render a halo that follows the actual motion.
  const tracePath = `${rawPath}.trace.tsv`;
  rmSync(tracePath, { force: true });
  process.env.MOUSE_TRACE_PATH = tracePath;

  // Process-level guard. If Node dies mid-record (Ctrl-C, uncaught
  // exception, parent shell killed) the spawned ffmpeg becomes an
  // orphan and avfoundation keeps it CPU-bound forever. This block
  // tracks every child we spawn and SIGKILLs them on any exit path.
  const spawnedChildren = new Set<ChildProcess>();
  const trackChild = (proc: ChildProcess): ChildProcess => {
    spawnedChildren.add(proc);
    proc.on("exit", () => spawnedChildren.delete(proc));
    return proc;
  };
  const cleanupChildren = (): void => {
    for (const proc of spawnedChildren) {
      try {
        if (proc.pid !== undefined) process.kill(proc.pid, "SIGKILL");
      } catch {
        // already dead
      }
    }
    spawnedChildren.clear();
  };
  const signalHandler = (sig: NodeJS.Signals): void => {
    console.warn(`record: caught ${sig}, killing ${spawnedChildren.size} child(ren) before exit`);
    cleanupChildren();
    process.exit(1);
  };
  const uncaughtHandler = (err: Error): void => {
    console.error(`record: uncaught: ${err.stack ?? err.message}`);
    cleanupChildren();
    process.exit(1);
  };
  process.on("SIGINT", signalHandler);
  process.on("SIGTERM", signalHandler);
  process.on("SIGHUP", signalHandler);
  process.on("uncaughtException", uncaughtHandler);
  process.on("unhandledRejection", uncaughtHandler);

  const ctx = await connectObsidian();
  try {
    // Pre-flight FIRST (we want Obsidian to be in a known state before
    // ffmpeg even sees a frame).
    await preflight({
      ctx,
      layout: storyboard.layout,
      freshIngest: storyboard.freshIngest,
      freshModel: storyboard.freshModel,
      clearTaskCenter: storyboard.clearTaskCenter,
      clearChat: storyboard.clearChat,
      preloadChatModel: storyboard.preloadChatModel,
      skipModelPin: storyboard.skipModelPin,
      noLilbee: storyboard.noLilbee,
    });

    const bounds = await getWindowBounds(ctx);
    console.log(`obsidian window: x=${bounds.x} y=${bounds.y} w=${bounds.w} h=${bounds.h}`);

    // Bring Obsidian to the front explicitly (so ffmpeg captures it,
    // not whatever was previously frontmost).
    await bringObsidianToFront();

    // Close any DevTools window before recording. Obsidian's CDP debug
    // port can leave a docked or floating DevTools open from a previous
    // session, and the screen capture happily includes it next to the
    // app window. The check looks for a devtools:// page in the same
    // CDP context; if present, we Cmd+Opt+I once to dismiss it.
    await closeDevtoolsIfOpen(ctx);

    // Park cursor at the storyboard's home before ffmpeg starts, so the
    // opening frame has a known cursor location and the first beat's
    // motion reads as a natural move, not a teleport into the action.
    const home = storyboard.cursorHome ?? [bounds.w - 60, bounds.h - 60];
    await moveToCoord(bounds.x + home[0], bounds.y + home[1]);

    // Re-pin the chat model right before recording. The preload step
    // can occasionally cause the plugin to flip active model if a
    // download finishes in the background. Re-pinning here is cheap.
    // MUST match preflight's DEFAULT_MODEL — pinning a model that isn't
    // installed (e.g. Qwen3 4B, which the shared registry doesn't have)
    // overrides the validated preflight pin and makes the on-camera chat
    // fail with "Internal error" at inference time.
    if (!storyboard.noLilbee && !storyboard.skipModelPin) {
      await ctx.page.evaluate(async (model) => {
        const p = (globalThis as unknown as { app: { plugins: { plugins: { lilbee: { settings: { serverUrl: string; manualToken?: string }; api?: { baseUrl: string; token?: string | null }; api?: { baseUrl: string }; fetchActiveModel?: () => Promise<void> } } } } }).app.plugins.plugins.lilbee;
        const base = p.api?.baseUrl ?? p.settings.serverUrl;
        await fetch(base + "/api/models/chat", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") },
          body: JSON.stringify({ model }),
        }).catch(() => {});
        if (typeof p.fetchActiveModel === "function") await p.fetchActiveModel();
      }, DEFAULT_MODEL);
    }

    // Start ffmpeg. Record both the spawn moment AND the "first frame
    // committed to disk" moment — the gap between them is dead time
    // that has to be trimmed away in post.
    const ffmpegSpawnedAt = Date.now();
    const ffmpeg = trackChild(startFfmpeg(rawPath));
    await waitForFfmpegFrame(rawPath);
    const recordingStartTime = Date.now();
    const ffmpegStartupGapMs = recordingStartTime - ffmpegSpawnedAt;
    console.log(`recording → ${rawPath} (ffmpeg startup gap: ${ffmpegStartupGapMs}ms)`);

    // Lead-in: held frame before first action
    await sleep(DEFAULT_LEAD_IN_MS);

    // Walk beats
    const records: BeatRecord[] = [];
    for (let i = 0; i < storyboard.beats.length; i++) {
      const beat = storyboard.beats[i];
      const startedAt = Date.now() - recordingStartTime;
      const cursor = await executeBeat(ctx, beat);
      const hold = beat.holdMs ?? DEFAULT_HOLD_MS;
      await sleep(hold);
      const endedAt = Date.now() - recordingStartTime;
      records.push({ index: i, label: beat.label, kind: beat.action.kind, startedAt, endedAt, cursor, speedup: beat.speedup });
      console.log(`beat ${i} [${beat.label}] ${beat.action.kind}: ${startedAt}-${endedAt} ms${cursor ? ` cursor=(${Math.round(cursor.x)},${Math.round(cursor.y)})` : ""}`);
    }

    // Tail: held frame after last action
    await sleep(DEFAULT_TAIL_MS);

    // Stop ffmpeg
    await stopFfmpeg(ffmpeg);

    const totalRecorded = Date.now() - recordingStartTime;

    // Persist timeline
    const timeline = {
      name: storyboard.name,
      layout: storyboard.layout,
      window: bounds,
      leadInMs: DEFAULT_LEAD_IN_MS,
      tailMs: DEFAULT_TAIL_MS,
      ffmpegStartupGapMs,
      totalRecordedMs: totalRecorded,
      beats: records,
    };
    writeFileSync(timelinePath, JSON.stringify(timeline, null, 2));

    // Post-process: trim + crop + re-encode, optional speedup + caption
    await postProcess({
      rawPath,
      outPath,
      timeline,
      trackChild,
      postSpeedup: storyboard.postSpeedup,
      caption: storyboard.caption,
      tracePath,
      recordingStartTime,
    });
    console.log(`webm → ${outPath}`);

    // Verification artifacts
    await buildReview(outPath, OUT_DIR, storyboard.name);
    console.log(`review → ${join(OUT_DIR, storyboard.name + ".contact.png")}`);
    console.log(`walkthrough → ${join(OUT_DIR, storyboard.name + ".walkthrough/")}`);

    // Clean up the raw + halo + trace — only the final webm is useful.
    rmSync(rawPath, { force: true });
    rmSync(tracePath, { force: true });
    rmSync(`${rawPath}.halo`, { recursive: true, force: true });
    rmSync(`${rawPath}.caption.png`, { force: true });
  } finally {
    restoreVaultFiles();
    await ctx.browser.close();
    cleanupChildren();
    process.off("SIGINT", signalHandler);
    process.off("SIGTERM", signalHandler);
    process.off("SIGHUP", signalHandler);
    process.off("uncaughtException", uncaughtHandler);
    process.off("unhandledRejection", uncaughtHandler);
  }
}

// -----------------------------------------------------------------------------

async function executeBeat(ctx: ObsidianContext, beat: Beat): Promise<{ x: number; y: number } | null> {
  return runAction(ctx, beat.action, beat);
}

async function runAction(ctx: ObsidianContext, action: Action, beat: Beat): Promise<{ x: number; y: number } | null> {
  switch (action.kind) {
    case "clickSelector":
      return await cursorClickSelector(ctx, action.selector, beat);
    case "rightClickSelector":
      return await cursorRightClickSelector(ctx, action.selector, beat);
    case "clickMenuItem":
      await clickMenuItem(action.name);
      return null;
    case "clickRibbon": {
      const sel = action.target === "chat" ? '[aria-label="Open lilbee chat"]' : '[aria-label="Open lilbee Task Center"]';
      return await cursorClickSelector(ctx, sel, beat);
    }
    case "clickSend":
      return await cursorClickSelector(ctx, ".lilbee-chat-send", beat);
    case "openSettings":
      await ctx.page.evaluate(() => (window as unknown as { app: { commands: { executeCommandById: (id: string) => void } } }).app.commands.executeCommandById("app:open-settings"));
      await sleep(450);
      // Then mouse-click the lilbee tab
      return await cursorClickSelector(ctx, ".vertical-tab-nav-item", { ...beat, label: beat.label + ":lilbee-tab" }, "lilbee");
    case "executeCommand":
      await ctx.page.evaluate((id) => (window as unknown as { app: { commands: { executeCommandById: (id: string) => void } } }).app.commands.executeCommandById(id), action.commandId);
      await sleep(450);
      return null;
    case "fillChat": {
      // Move the cursor onto the chat textarea first so the viewer sees
      // the click land on the input before text starts streaming in.
      // Without this, the cursor sits wherever the previous beat left
      // it and text appears in a field the cursor isn't anywhere near.
      const coord = await resolveSelector(ctx, "textarea.lilbee-chat-textarea");
      if (coord) {
        await moveToCoord(coord.x, coord.y);
        await sleep(HOVER_BEFORE_CLICK_MS);
        await clickAtCoord(coord.x, coord.y);
      } else {
        await ctx.page.evaluate(() => (document.querySelector("textarea.lilbee-chat-textarea") as HTMLElement | null)?.focus());
      }
      await typeText(action.text);
      return coord;
    }
    case "type":
      await typeText(action.text);
      return null;
    case "key":
      await pressKey(action.key);
      return null;
    case "sleep":
      await sleep(action.ms);
      return null;
    case "waitForSelector":
      await ctx.page.waitForSelector(action.selector, { timeout: 60_000 });
      return null;
    case "waitChatIdle":
      await waitChatIdle(ctx, action.maxMs);
      return null;
    case "settingsScrollTo":
      await settingsScrollTo(ctx, action.anchor);
      return null;
    case "screenshot":
      return null;
    case "wheelScroll": {
      const coord = await resolveSelector(ctx, action.selector);
      if (!coord) {
        console.warn(`wheelScroll: no element for beat '${beat.label}' (${action.selector}); skipping`);
        return null;
      }
      await scrollAt(coord.x, coord.y, action.ticks, action.fast ?? false);
      return coord;
    }
    case "runJs":
      await withTimeout(
        ctx.page.evaluate(`(async () => {\n${action.js}\n})()`),
        beat.maxMs ?? RUN_JS_BEAT_TIMEOUT_MS,
        beat.label,
      );
      return null;
    case "clickChip":
      return await cursorClickChip(ctx, action.index, beat);
    case "clickSourceFile":
      return await cursorClickSourceFile(ctx, action.name, beat);
  }
}

async function cursorClickSelector(
  ctx: ObsidianContext,
  selector: string,
  beat: Beat,
  textIs?: string,
): Promise<{ x: number; y: number }> {
  return await cursorActOnSelector(ctx, selector, beat, textIs, "left");
}

async function cursorRightClickSelector(
  ctx: ObsidianContext,
  selector: string,
  beat: Beat,
  textIs?: string,
): Promise<{ x: number; y: number }> {
  return await cursorActOnSelector(ctx, selector, beat, textIs, "right");
}

async function cursorActOnSelector(
  ctx: ObsidianContext,
  selector: string,
  beat: Beat,
  textIs: string | undefined,
  button: "left" | "right",
): Promise<{ x: number; y: number }> {
  // Support Playwright-style :has-text("...") and :text-is("...") sugar
  // by extracting the text and matching against textContent in the
  // resolveSelector helper. :text-is is exact, :has-text is substring.
  let cleanSelector = selector;
  let effectiveTextIs = textIs;
  let effectiveTextHas: string | undefined;
  const hasTextMatch = selector.match(/:has-text\(["'](.+?)["']\)/);
  const textIsMatch = selector.match(/:text-is\(["'](.+?)["']\)/);
  if (textIsMatch) {
    effectiveTextIs = textIsMatch[1];
    cleanSelector = selector.replace(/:text-is\(["'].+?["']\)/, "");
  } else if (hasTextMatch) {
    effectiveTextHas = hasTextMatch[1];
    cleanSelector = selector.replace(/:has-text\(["'].+?["']\)/, "");
  }
  const coord = await resolveSelector(ctx, cleanSelector, { textIs: effectiveTextIs, textHas: effectiveTextHas });
  if (!coord) throw new Error(`cannot resolve selector for beat '${beat.label}': ${selector}`);
  await moveToCoord(coord.x, coord.y);
  await sleep(HOVER_BEFORE_CLICK_MS);
  if (button === "right") {
    // Real OS right-click via pyautogui so Obsidian's native context
    // menu opens on screen for the recording. Playwright's in-page
    // right-click doesn't trigger Obsidian's file-menu event.
    await rightClickAtCoord(coord.x, coord.y);
  } else {
    await clickAtCoord(coord.x, coord.y);
  }
  if (beat.cursorParkTo) {
    const [px, py] = beat.cursorParkTo;
    await moveToCoord(ctx.windowOrigin.x + px, ctx.windowOrigin.y + py);
  }
  return coord;
}

async function cursorClickChip(ctx: ObsidianContext, index: number, beat: Beat): Promise<{ x: number; y: number } | null> {
  // Force-open source <details> AND scroll the chip into view. With PDF
  // citations the chip area renders below the textarea fold, so the
  // resolved bounding rect can be off-screen and the click lands on
  // whatever is in front of it. scrollIntoView puts the chip in the
  // visible scroll region before we measure its coords.
  await ctx.page.evaluate((idx) => {
    document.querySelectorAll(".lilbee-chat-sources details").forEach((d) => ((d as HTMLDetailsElement).open = true));
    const chips = document.querySelectorAll(".lilbee-source-chip-loc");
    const target = chips[idx] as HTMLElement | undefined;
    target?.scrollIntoView({ block: "center", behavior: "instant" });
  }, index);
  await sleep(350);
  const coord = await resolveByJs(
    ctx,
    `const chips = document.querySelectorAll('.lilbee-source-chip-loc'); return chips[${index}] ?? null;`,
  );
  if (!coord) {
    console.warn(`clickChip ${index}: no chip rendered for beat '${beat.label}' (answer had no citations); skipping`);
    return null;
  }
  await moveToCoord(coord.x, coord.y);
  await sleep(HOVER_BEFORE_CLICK_MS);
  await clickAtCoord(coord.x, coord.y);
  if (beat.cursorParkTo) {
    const [px, py] = beat.cursorParkTo;
    await moveToCoord(ctx.windowOrigin.x + px, ctx.windowOrigin.y + py);
  }
  return coord;
}

async function cursorClickSourceFile(
  ctx: ObsidianContext,
  name: string,
  beat: Beat,
): Promise<{ x: number; y: number } | null> {
  // Force the sources <details> open and scroll the matching file's chip
  // into view before measuring its coordinates.
  await ctx.page.evaluate((n) => {
    document.querySelectorAll(".lilbee-chat-sources details").forEach((d) => ((d as HTMLDetailsElement).open = true));
    const groups = Array.from(document.querySelectorAll(".lilbee-source-chip-grouped"));
    const group = groups.find((g) => (g.querySelector(".lilbee-source-chip-file")?.textContent ?? "").includes(n));
    group?.querySelector(".lilbee-source-chip-loc")?.scrollIntoView({ block: "center", behavior: "instant" });
  }, name);
  await sleep(350);
  const coord = await resolveByJs(
    ctx,
    `const groups = Array.from(document.querySelectorAll('.lilbee-source-chip-grouped'));
     const group = groups.find(g => (g.querySelector('.lilbee-source-chip-file')?.textContent ?? '').includes(${JSON.stringify(name)}));
     return group?.querySelector('.lilbee-source-chip-loc') ?? null;`,
  );
  if (!coord) {
    console.warn(`clickSourceFile: no cited source matching '${name}' for beat '${beat.label}'; skipping`);
    return null;
  }
  await moveToCoord(coord.x, coord.y);
  await sleep(HOVER_BEFORE_CLICK_MS);
  await clickAtCoord(coord.x, coord.y);
  return coord;
}

async function waitChatIdle(ctx: ObsidianContext, maxMs: number): Promise<void> {
  const deadline = Date.now() + maxMs;
  let sawStop = false;
  while (Date.now() < deadline) {
    const text = await ctx.page.evaluate(() => document.querySelector(".lilbee-chat-send")?.textContent ?? "");
    if (text.includes("Stop")) sawStop = true;
    if (sawStop && text.includes("Send")) return;
    await sleep(300);
  }
  console.warn("waitChatIdle timed out");
}

async function settingsScrollTo(ctx: ObsidianContext, anchor: string): Promise<void> {
  await ctx.page.evaluate((a) => {
    const scroller = document.querySelector(".vertical-tab-content") as HTMLElement | null;
    if (!scroller) return;
    const candidates = scroller.querySelectorAll("h1,h2,h3,.setting-item-name,summary");
    for (const el of Array.from(candidates)) {
      const t = (el as HTMLElement).innerText.trim().toLowerCase();
      if (t.startsWith(a.toLowerCase())) {
        const r = (el as HTMLElement).getBoundingClientRect();
        const sr = scroller.getBoundingClientRect();
        const top = scroller.scrollTop + (r.top - sr.top) - 40;
        scroller.scrollTo({ top, behavior: "smooth" });
        return;
      }
    }
  }, anchor);
  await sleep(900);
}

// -----------------------------------------------------------------------------
// ffmpeg control

function startFfmpeg(outPath: string): ChildProcess {
  // h264 ultrafast intermediate: libvpx-vp9 realtime drops most frames
  // at retina 3456x2234, even at 4 Mbps. Empirical test 2026-05-18:
  // first 1s holds 30 fps, then collapses to ~2 fps. Cursor motion
  // becomes invisible. h264 ultrafast holds steady 30 fps throughout.
  // The existing post-process pass transcodes to VP9 at -deadline good.
  const args = [
    "-y",
    "-f", "avfoundation",
    "-framerate", "30",
    "-capture_cursor", "1",
    "-i", "1:none",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    // Fragmented mp4 keeps the file readable even if the muxer is
    // interrupted before writing the trailing moov atom. Without
    // this, a hard stop loses the entire recording.
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
    outPath,
  ];
  return spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
}

async function waitForFfmpegFrame(rawPath: string): Promise<void> {
  // Wait until ffmpeg has written the first chunk so the recording actually started.
  for (let i = 0; i < 50; i++) {
    if (existsSync(rawPath)) {
      const sz = (await import("node:fs")).statSync(rawPath).size;
      if (sz > 100_000) return;
    }
    await sleep(100);
  }
}

async function stopFfmpeg(ffmpeg: ChildProcess): Promise<void> {
  return new Promise((resolveExit, reject) => {
    ffmpeg.on("exit", () => resolveExit());
    ffmpeg.on("error", reject);
    // SIGINT triggers ffmpeg's clean shutdown (writes any buffered
    // packets + finalizes the muxer). VP9 encoding flush can take a
    // while on a long recording; give it generous time before the
    // hard kill so the tail of the demo isn't lost.
    ffmpeg.kill("SIGINT");
    setTimeout(() => {
      try { ffmpeg.kill("SIGKILL"); } catch {}
    }, 30_000);
  });
}

async function bringObsidianToFront(): Promise<void> {
  await new Promise<void>((res, rej) => {
    const proc = spawn("osascript", ["-e", 'tell application "Obsidian" to activate']);
    proc.on("error", rej);
    proc.on("exit", () => res());
  });
  await sleep(500);
}

async function closeDevtoolsIfOpen(ctx: ObsidianContext): Promise<void> {
  const pages = ctx.browser.contexts()[0].pages();
  const devtoolsOpen = pages.some((p) => p.url().startsWith("devtools://"));
  if (!devtoolsOpen) return;
  await new Promise<void>((res, rej) => {
    const proc = spawn("osascript", [
      "-e",
      'tell application "System Events" to tell process "Obsidian" to keystroke "i" using {command down, option down}',
    ]);
    proc.on("error", rej);
    proc.on("exit", () => res());
  });
  await sleep(500);
}

// -----------------------------------------------------------------------------
// Post-process

type PostOptions = {
  rawPath: string;
  outPath: string;
  timeline: {
    leadInMs: number;
    tailMs: number;
    ffmpegStartupGapMs: number;
    totalRecordedMs: number;
    window: { x: number; y: number; w: number; h: number };
    beats: BeatRecord[];
  };
  trackChild: (proc: ChildProcess) => ChildProcess;
  postSpeedup?: number;
  caption?: string;
  tracePath?: string;
  recordingStartTime?: number;
};

async function postProcess(opts: PostOptions): Promise<void> {
  const { rawPath, outPath, timeline, trackChild, postSpeedup, caption, tracePath, recordingStartTime } = opts;
  const rawDurSec = await probeDurationSec(rawPath);
  const startMs = Math.max(0, timeline.ffmpegStartupGapMs - timeline.leadInMs);
  const last = timeline.beats[timeline.beats.length - 1];
  const lastEndMs = last?.endedAt ?? 0;
  const endMs = timeline.ffmpegStartupGapMs + lastEndMs + timeline.tailMs;
  const rawDurMs = rawDurSec * 1000;
  const cappedEndMs = rawDurMs > 0 ? Math.min(endMs, rawDurMs) : endMs;
  if (rawDurMs > 0 && cappedEndMs < endMs) {
    console.warn(`post-process: raw ended at ${rawDurMs} ms but beats wanted ${endMs} ms; trimming to what was captured`);
  }
  if (rawDurMs === 0) {
    console.warn(`post-process: raw duration unknown (muxer not finalised) — encoding what's readable`);
  }
  // Crop in retina pixels.
  const cropX = timeline.window.x * 2;
  const cropY = timeline.window.y * 2;
  const cropW = timeline.window.w * 2;
  const cropH = timeline.window.h * 2;

  // Plan segments: walk the timeline in input time (relative to the
  // trimmed input start) and split it into runs of consecutive same-
  // speedup beats, with the lead-in and tail and any inter-beat gaps
  // counted as 1x runs. Apply any global postSpeedup multiplicatively.
  const globalMul = postSpeedup && postSpeedup > 1 ? postSpeedup : 1;
  const segments: { inStartMs: number; inEndMs: number; speedup: number }[] = [];
  let prevEnd = 0; // input time, ms (relative to trim start)
  const trimStart = startMs;
  const trimEnd = cappedEndMs;
  for (const b of timeline.beats) {
    // Convert raw beat times to input-relative ms.
    const rawBeatStart = timeline.ffmpegStartupGapMs + b.startedAt;
    const rawBeatEnd = timeline.ffmpegStartupGapMs + b.endedAt;
    const inStart = Math.max(0, rawBeatStart - trimStart);
    const inEnd = Math.min(trimEnd - trimStart, rawBeatEnd - trimStart);
    if (inEnd <= inStart) continue;
    if (inStart > prevEnd) {
      pushSegment(segments, { inStartMs: prevEnd, inEndMs: inStart, speedup: globalMul });
    }
    const beatSpeedup = Math.max(1, (b.speedup ?? 1) * globalMul);
    pushSegment(segments, { inStartMs: inStart, inEndMs: inEnd, speedup: beatSpeedup });
    prevEnd = inEnd;
  }
  const totalIn = trimEnd - trimStart;
  if (prevEnd < totalIn) {
    pushSegment(segments, { inStartMs: prevEnd, inEndMs: totalIn, speedup: globalMul });
  }

  // Compute the output time range covered by each segment so the
  // "Sped up Nx" caption can be enabled exactly while it's on screen.
  let outAccum = 0;
  const segOutRanges: { speedup: number; outStart: number; outEnd: number }[] = [];
  for (const s of segments) {
    const inDur = (s.inEndMs - s.inStartMs) / 1000;
    const outDur = inDur / s.speedup;
    segOutRanges.push({ speedup: s.speedup, outStart: outAccum, outEnd: outAccum + outDur });
    outAccum += outDur;
  }

  // Render a "Sped up Nx" caption PNG per distinct speedup > 1.
  const distinctSpeedups = Array.from(new Set(segments.map((s) => s.speedup))).filter((s) => s > 1);
  const speedupCaptionPaths = new Map<number, string>();
  for (const sp of distinctSpeedups) {
    const text = `Sped up ${formatSpeedup(sp)}×`;
    const path = `${rawPath}.sped-${sp.toFixed(2)}.png`;
    await renderCaptionPng(text, path);
    speedupCaptionPaths.set(sp, path);
  }

  // Optional global caption (hardware info).
  let captionPath: string | null = null;
  if (caption) {
    captionPath = `${rawPath}.caption.png`;
    await renderCaptionPng(caption, captionPath);
  }

  // The real OS cursor is captured by ffmpeg (-capture_cursor 1) and is the
  // single cursor in the reel: it's the genuine contextual pointer (arrow,
  // hand over links). We do NOT overlay a synthetic cursor — on this macOS the
  // hardware cursor is composited into the capture regardless of the
  // capture_cursor flag, so a synthetic overlay would double it.
  void tracePath;
  void recordingStartTime;

  // Build the ffmpeg filter graph.
  const ffArgs: string[] = ["-y", "-ss", String(startMs / 1000), "-i", rawPath, "-t", String((trimEnd - trimStart) / 1000)];
  let inputIdx = 1;
  const speedupInputIdx = new Map<number, number>();
  for (const sp of distinctSpeedups) {
    ffArgs.push("-i", speedupCaptionPaths.get(sp) ?? "");
    speedupInputIdx.set(sp, inputIdx);
    inputIdx++;
  }
  let captionInputIdx: number | null = null;
  if (captionPath) {
    ffArgs.push("-i", captionPath);
    captionInputIdx = inputIdx;
    inputIdx++;
  }

  const chain: string[] = [];
  chain.push(`[0:v]crop=${cropW}:${cropH}:${cropX}:${cropY}[v_crop]`);
  chain.push(`[v_crop]split=${segments.length}${segments.map((_, i) => `[c${i}]`).join("")}`);
  const segOuts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const a = (s.inStartMs / 1000).toFixed(3);
    const b = (s.inEndMs / 1000).toFixed(3);
    const ptsExpr = s.speedup === 1 ? "PTS-STARTPTS" : `(PTS-STARTPTS)/${s.speedup}`;
    chain.push(`[c${i}]trim=start=${a}:end=${b},setpts=${ptsExpr}[s${i}]`);
    segOuts.push(`[s${i}]`);
  }
  chain.push(`${segOuts.join("")}concat=n=${segments.length}:v=1:a=0[v_concat]`);
  let lastLabel = "v_concat";

  // Per-speedup captions, enable= only within sped-up output windows.
  for (const sp of distinctSpeedups) {
    const ranges = segOutRanges.filter((r) => r.speedup === sp);
    const enable = ranges.map((r) => `between(t,${r.outStart.toFixed(3)},${r.outEnd.toFixed(3)})`).join("+");
    const next = `v_sp${distinctSpeedups.indexOf(sp)}`;
    chain.push(`[${lastLabel}][${speedupInputIdx.get(sp)}:v]overlay=W-w-32:32:enable='${enable}'[${next}]`);
    lastLabel = next;
  }

  // Global caption (always on).
  if (captionPath && captionInputIdx !== null) {
    // Place global caption at top-LEFT so it never collides with the
    // top-right "Sped up Nx" badge.
    chain.push(`[${lastLabel}][${captionInputIdx}:v]overlay=32:32[v_globcap]`);
    lastLabel = "v_globcap";
  }

  ffArgs.push("-filter_complex", chain.join("; "), "-map", `[${lastLabel}]`);
  ffArgs.push("-c:v", "libvpx-vp9", "-b:v", "6M", "-row-mt", "1", "-deadline", "good", outPath);
  console.log(`post-process: ${segments.length} segments, distinct speedups: ${distinctSpeedups.length ? distinctSpeedups.join(", ") : "none"}`);
  await new Promise<void>((res, rej) => {
    const args = ffArgs;
    const proc = trackChild(spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] }));
    proc.on("error", rej);
    proc.on("exit", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg post exit ${code}`))));
  });
}

function pushSegment(
  segments: { inStartMs: number; inEndMs: number; speedup: number }[],
  seg: { inStartMs: number; inEndMs: number; speedup: number },
): void {
  if (seg.inEndMs <= seg.inStartMs) return;
  const last = segments[segments.length - 1];
  if (last && last.speedup === seg.speedup && Math.abs(last.inEndMs - seg.inStartMs) < 1) {
    last.inEndMs = seg.inEndMs;
    return;
  }
  segments.push(seg);
}

function formatSpeedup(s: number): string {
  if (Number.isInteger(s)) return String(s);
  return s.toFixed(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function renderHaloFrames(
  tracePath: string,
  outDir: string,
  width: number,
  height: number,
  startMs: number,
  durationMs: number,
  fps: number,
  cropX: number,
  cropY: number,
): Promise<void> {
  const haloPy = join(__dirname, "halo.py");
  await new Promise<void>((res, rej) => {
    const proc = spawn(
      "python3",
      [
        haloPy,
        tracePath,
        outDir,
        String(width),
        String(height),
        String(Math.round(startMs)),
        String(Math.round(durationMs)),
        String(fps),
        String(cropX),
        String(cropY),
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    proc.on("error", rej);
    proc.on("exit", (code) => (code === 0 ? res() : rej(new Error(`halo render exit ${code}`))));
  });
}

async function renderCaptionPng(text: string, outPath: string): Promise<void> {
  // Render with Python PIL: white text on translucent dark box.
  const py = `
import sys
from PIL import Image, ImageDraw, ImageFont
text = sys.argv[1]
out = sys.argv[2]
font_size = 36
# Try common macOS fonts.
font = None
for p in ["/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"]:
    try:
        font = ImageFont.truetype(p, font_size)
        break
    except Exception:
        continue
if font is None:
    font = ImageFont.load_default()
pad = 18
bbox = font.getbbox(text)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
img = Image.new("RGBA", (tw + 2 * pad, th + 2 * pad), (0, 0, 0, 140))
ImageDraw.Draw(img).text((pad, pad - bbox[1]), text, fill=(255, 255, 255, 255), font=font)
img.save(out)
`;
  await new Promise<void>((res, rej) => {
    const proc = spawn("python3", ["-c", py, text, outPath], { stdio: ["ignore", "ignore", "inherit"] });
    proc.on("error", rej);
    proc.on("exit", (code) => (code === 0 ? res() : rej(new Error(`caption render exit ${code}`))));
  });
}

async function probeDurationSec(file: string): Promise<number> {
  return new Promise((res) => {
    const proc = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nokey=1", file], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    proc.stdout.on("data", (b) => (out += b.toString()));
    proc.on("exit", () => res(parseFloat(out.trim()) || 0));
    proc.on("error", () => res(0));
  });
}

// Silence unused-import warnings during incremental dev.
void parkCursor;
void REPO_ROOT;
