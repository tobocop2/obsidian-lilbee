/**
 * Build verification artifacts for a rendered demo.
 *
 *   1. <name>.contact.png — a 4×2 grid of 8 evenly-spaced frames.
 *      Quick "did the demo capture the right thing" check.
 *   2. <name>.walkthrough/NNN.png — one frame per second, named so
 *      they sort sequentially. The closest stand-in for "watch the
 *      webm end-to-end" given the harness can read images, not video.
 *
 * Both run via the system ffmpeg + ImageMagick `montage` if available;
 * if `montage` is missing we fall back to a horizontal concat with the
 * standard ffmpeg `hstack` filter, which lays the 8 frames out as one
 * tall strip.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

async function ffprobeDuration(webmPath: string): Promise<number> {
  return new Promise((res, rej) => {
    const proc = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nokey=1", webmPath], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    proc.stdout.on("data", (b) => (out += b.toString()));
    proc.on("error", rej);
    proc.on("exit", () => res(parseFloat(out.trim())));
  });
}

function runCmd(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "ignore", "ignore"] });
    proc.on("error", rej);
    proc.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} exit ${code}`))));
  });
}

async function which(cmd: string): Promise<boolean> {
  return new Promise((res) => {
    const proc = spawn("which", [cmd], { stdio: ["ignore", "ignore", "ignore"] });
    proc.on("exit", (code) => res(code === 0));
    proc.on("error", () => res(false));
  });
}

export async function buildReview(webmPath: string, outDir: string, name: string): Promise<void> {
  const duration = await ffprobeDuration(webmPath);

  // Contact sheet: 8 frames evenly spaced
  const contactDir = join(outDir, `${name}.contact-frames`);
  rmSync(contactDir, { recursive: true, force: true });
  mkdirSync(contactDir, { recursive: true });
  for (let i = 0; i < 8; i++) {
    const t = (duration * (i + 1)) / 9;
    await runCmd("ffmpeg", [
      "-y", "-v", "error",
      "-ss", String(t),
      "-i", webmPath,
      "-frames:v", "1",
      "-vf", "scale=720:-1",
      join(contactDir, `f${i}.png`),
    ]);
  }

  const contactPath = join(outDir, `${name}.contact.png`);
  if (await which("montage")) {
    const frames = readdirSync(contactDir).filter((f) => f.endsWith(".png")).sort().map((f) => join(contactDir, f));
    await runCmd("montage", [...frames, "-tile", "4x2", "-geometry", "+8+8", "-background", "#1a1a1a", contactPath]);
  } else {
    // Fallback: ffmpeg hstack to a tall vertical strip
    const frames = readdirSync(contactDir).filter((f) => f.endsWith(".png")).sort();
    if (frames.length) {
      const inputs = frames.flatMap((f) => ["-i", join(contactDir, f)]);
      const filter = frames.map((_, i) => `[${i}:v]`).join("") + `vstack=inputs=${frames.length}[v]`;
      await runCmd("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", filter, "-map", "[v]", contactPath]);
    }
  }
  rmSync(contactDir, { recursive: true, force: true });

  // Walkthrough: 1 frame per second of the final webm
  const walkthroughDir = join(outDir, `${name}.walkthrough`);
  rmSync(walkthroughDir, { recursive: true, force: true });
  mkdirSync(walkthroughDir, { recursive: true });
  await runCmd("ffmpeg", [
    "-y", "-v", "error",
    "-i", webmPath,
    "-vf", "fps=1,scale=720:-1",
    join(walkthroughDir, "%03d.png"),
  ]);
}
