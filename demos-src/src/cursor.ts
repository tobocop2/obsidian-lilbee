/**
 * Thin TypeScript wrapper around demos/src/mouse.py.
 *
 * The Node harness asks the Python helper to drive the OS cursor.
 * pyautogui interpolates smoothly along a Bezier so ffmpeg captures
 * continuous motion instead of the teleport that bare MCP
 * ``mouse_move`` gives us.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOUSE_PY = join(__dirname, "mouse.py");

function run(args: string[], cursorStyle?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Inherit env so MOUSE_TRACE_PATH (set by record.ts) reaches the
    // mouse.py subprocess and per-step cursor positions get logged.
    // MOUSE_CURSOR_STYLE tells mouse.py the destination cursor style so
    // the trace's resting point records the right glyph (hand / I-beam).
    const env = cursorStyle ? { ...process.env, MOUSE_CURSOR_STYLE: cursorStyle } : process.env;
    const proc = spawn("python3", [MOUSE_PY, ...args], { stdio: ["ignore", "pipe", "pipe"], env });
    let out = "";
    let err = "";
    proc.stdout.on("data", (b) => (out += b.toString()));
    proc.stderr.on("data", (b) => (err += b.toString()));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`mouse.py ${args.join(" ")} exited ${code}: ${err}`));
    });
  });
}

/** Smoothly move the OS cursor to (x, y) — screen logical points. The
 * optional cursorStyle (CSS cursor under the destination) selects the
 * glyph the overlay draws at rest. */
export async function moveToCoord(x: number, y: number, cursorStyle?: string): Promise<void> {
  await run(["move", String(x), String(y)], cursorStyle);
}

/** Smooth-move then click. */
export async function clickAtCoord(x: number, y: number, cursorStyle?: string): Promise<void> {
  await run(["click", String(x), String(y)], cursorStyle);
}

/** Smooth-move then right-click. */
export async function rightClickAtCoord(x: number, y: number, cursorStyle?: string): Promise<void> {
  await run(["rightclick", String(x), String(y)], cursorStyle);
}

/** Smooth-move the cursor onto a native context-menu item by name (via
 * AppleScript) and click it. Use after a real right-click to drive
 * Obsidian's file-menu visibly. */
export async function clickMenuItem(name: string): Promise<void> {
  await run(["menu", name]);
}

/** Type text into whatever currently has keyboard focus, with natural per-char delay. */
export async function typeText(text: string): Promise<void> {
  await run(["type", text]);
}

/** Press a key (e.g. "escape", "return"). */
export async function pressKey(key: string): Promise<void> {
  await run(["key", key]);
}

/** Smooth-move to (x, y) then scroll N ticks (positive = up). When `fast`
 * is set, the scroll uses larger bursts and shorter pauses — a quick flick
 * through a long list rather than a deliberate read. */
export async function scrollAt(x: number, y: number, ticks: number, fast = false): Promise<void> {
  await run(["scroll", String(x), String(y), String(ticks), ...(fast ? ["fast"] : [])]);
}

/** Park cursor to a non-distracting home position. Default: bottom-right of the Obsidian window. */
export async function parkCursor(x: number, y: number): Promise<void> {
  await moveToCoord(x, y);
}

/** Current cursor position. */
export async function cursorPosition(): Promise<{ x: number; y: number }> {
  const out = await run(["pos"]);
  const [x, y] = out.split(/\s+/).map(Number);
  return { x, y };
}
