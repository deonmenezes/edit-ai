export type ClipKind = "video" | "text" | "audio"

export type Clip = {
  id: string
  name: string
  kind: ClipKind
  trackId: string
  /** seconds */
  start: number
  /** seconds */
  duration: number
}

export type Track = {
  id: string
  label: string
  kind: ClipKind
}

export type Project = {
  name: string
  fps: number
  /** seconds */
  duration: number
  tracks: Track[]
  clips: Clip[]
}

export const PROJECT: Project = {
  name: "Untitled project",
  fps: 30,
  duration: 24,
  tracks: [
    { id: "v1", label: "V1", kind: "video" },
    { id: "t1", label: "T1", kind: "text" },
    { id: "a1", label: "A1", kind: "audio" },
    { id: "a2", label: "A2", kind: "audio" },
  ],
  clips: [
    { id: "c1", name: "intro.mp4", kind: "video", trackId: "v1", start: 0, duration: 5 },
    { id: "c2", name: "b-roll.mp4", kind: "video", trackId: "v1", start: 5, duration: 6 },
    { id: "c3", name: "talking-head.mp4", kind: "video", trackId: "v1", start: 11, duration: 13 },
    { id: "c4", name: "Hook line", kind: "text", trackId: "t1", start: 0.5, duration: 3.5 },
    { id: "c5", name: "Subscribe", kind: "text", trackId: "t1", start: 20, duration: 4 },
    { id: "c6", name: "voiceover.wav", kind: "audio", trackId: "a1", start: 0, duration: 24 },
    { id: "c7", name: "music.mp3", kind: "audio", trackId: "a2", start: 0, duration: 24 },
  ],
}

export const CLIP_TONE: Record<ClipKind, string> = {
  video: "var(--clip-video)",
  text: "var(--clip-text)",
  audio: "var(--clip-audio)",
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/** hh:mm:ss:ff */
export function formatTimecode(seconds: number, fps = 30) {
  const total = Math.max(0, seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const f = Math.floor((total - Math.floor(total)) * fps)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`
}

/** m:ss for ruler labels */
export function formatShort(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}

export function clipsAt(project: Project, time: number) {
  return project.clips.filter((c) => time >= c.start && time < c.start + c.duration)
}
