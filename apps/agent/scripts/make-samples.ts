/**
 * Generate real sample footage with ffmpeg, for trying EditAI without your own media.
 *
 * These are genuine encoded files, not fixtures: the editor decodes them, the analyzer
 * measures them, and the exporter re-encodes them. The voiceover has real gaps at known
 * times so silence detection has something true to find.
 *
 *   bun scripts/make-samples.ts [outDir]
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] ?? join(here, "..", "data", "samples")

/** Gaps the voiceover really contains, so `find_silences` can be checked against the truth. */
export const SILENCES = [
  { start: 3.2, end: 4.1 },
  { start: 9.6, end: 10.4 },
  { start: 16.8, end: 18.0 },
]

const gate = SILENCES.map((s) => `between(t,${s.start},${s.end})`).join("+")

const CLIPS: { file: string; args: string[] }[] = [
  {
    file: "intro.mp4",
    args: ["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=5", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast"],
  },
  {
    file: "b-roll.mp4",
    args: ["-f", "lavfi", "-i", "smptebars=size=1280x720:rate=30:duration=6", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast"],
  },
  {
    file: "talking-head.mp4",
    args: [
      "-f", "lavfi", "-i", "gradients=size=1280x720:rate=30:duration=13:c0=0x2b2440:c1=0x0e0e10",
      "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast",
    ],
  },
  {
    file: "voiceover.wav",
    args: [
      "-f", "lavfi",
      "-i", `aevalsrc='if(${gate},0,0.35*sin(2*PI*210*t)*(0.55+0.45*sin(2*PI*3.1*t)))':d=24:s=48000`,
      "-c:a", "pcm_s16le",
    ],
  },
  {
    file: "music.mp3",
    // 120 BPM: a decaying click every half second, so tempo estimation has a real beat.
    args: ["-f", "lavfi", "-i", "aevalsrc='0.45*sin(2*PI*760*t)*exp(-26*mod(t,0.5))':d=24:s=48000", "-c:a", "libmp3lame", "-b:a", "192k"],
  },
]

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    child.stderr.on("data", (d) => (stderr += d))
    child.on("error", (err) => reject(new Error(`ffmpeg could not start: ${err.message}. Install it with: brew install ffmpeg`)))
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `ffmpeg exited with ${code}`))))
  })
}

if (import.meta.main) {
  mkdirSync(outDir, { recursive: true })
  for (const clip of CLIPS) {
    const target = join(outDir, clip.file)
    if (existsSync(target)) {
      console.log(`  exists  ${clip.file}`)
      continue
    }
    await run([...clip.args, target])
    console.log(`  wrote   ${clip.file}`)
  }
  console.log(`\nSample media in ${outDir}`)
  console.log("Drop these onto the editor to import them. The voiceover has real silences at 3.2s, 9.6s and 16.8s.")
}
