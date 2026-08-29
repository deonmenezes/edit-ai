import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export type ClipKind = "video" | "text" | "audio"

export type Clip = {
  id: string
  name: string
  kind: ClipKind
  trackId: string
  /** timeline seconds */
  start: number
  /** seconds */
  duration: number
  /** offset into the source media, seconds */
  sourceOffset: number
  /** 0..100 */
  volume?: number
}

export type Track = { id: string; label: string; kind: ClipKind }

export type Segment = { start: number; end: number; text?: string }

export type MediaInfo = {
  /** source media duration in seconds */
  duration: number
  /** detected silences in source time */
  silences?: Segment[]
  /** transcript in source time */
  transcript?: Segment[]
  /** beats per minute, for music */
  bpm?: number
}

export type ExportRecord = {
  id: string
  format: string
  resolution: string
  createdAt: string
  durationSeconds: number
  file: string
}

export type Project = {
  name: string
  fps: number
  duration: number
  tracks: Track[]
  clips: Clip[]
  media: Record<string, MediaInfo>
  exports: ExportRecord[]
}

export type Change = { id: number; at: string; op: string; summary: string }

const round = (n: number) => Math.round(n * 1000) / 1000

export function seedProject(): Project {
  return {
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
      { id: "c1", name: "intro.mp4", kind: "video", trackId: "v1", start: 0, duration: 5, sourceOffset: 0 },
      { id: "c2", name: "b-roll.mp4", kind: "video", trackId: "v1", start: 5, duration: 6, sourceOffset: 0 },
      { id: "c3", name: "talking-head.mp4", kind: "video", trackId: "v1", start: 11, duration: 13, sourceOffset: 0 },
      { id: "c4", name: "Hook line", kind: "text", trackId: "t1", start: 0.5, duration: 3.5, sourceOffset: 0 },
      { id: "c5", name: "Subscribe", kind: "text", trackId: "t1", start: 20, duration: 4, sourceOffset: 0 },
      { id: "c6", name: "voiceover.wav", kind: "audio", trackId: "a1", start: 0, duration: 24, sourceOffset: 0, volume: 100 },
      { id: "c7", name: "music.mp3", kind: "audio", trackId: "a2", start: 0, duration: 24, sourceOffset: 0, volume: 35 },
    ],
    media: {
      "intro.mp4": { duration: 5 },
      "b-roll.mp4": { duration: 6 },
      "talking-head.mp4": { duration: 13 },
      "voiceover.wav": {
        duration: 24,
        silences: [
          { start: 3.2, end: 4.1 },
          { start: 9.6, end: 10.4 },
          { start: 16.8, end: 18.0 },
        ],
        transcript: [
          { start: 0.4, end: 3.1, text: "Most editors waste hours on cuts a machine should make." },
          { start: 4.2, end: 7.5, text: "EditAI reads your timeline and does the boring parts." },
          { start: 7.6, end: 9.5, text: "Silences, captions, pacing." },
          { start: 10.5, end: 14.0, text: "You describe the change, it edits, you approve." },
          { start: 14.1, end: 16.7, text: "Every destructive step waits for a human." },
          { start: 18.1, end: 21.0, text: "It runs on any model and any tools you plug in." },
          { start: 21.2, end: 23.6, text: "Subscribe if you want to see where this goes." },
        ],
      },
      "music.mp3": { duration: 24, bpm: 120 },
    },
    exports: [],
  }
}

export class ProjectStore {
  private project: Project
  private snapshots: Project[] = []
  private changes: Change[] = []
  private listeners = new Set<(p: Project, change: Change | null) => void>()
  revision = 0

  constructor(private file?: string) {
    this.project = file && existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Project) : seedProject()
  }

  get(): Project {
    return structuredClone(this.project)
  }

  listChanges(limit = 20): Change[] {
    return this.changes.slice(-limit)
  }

  subscribe(fn: (p: Project, change: Change | null) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  reset() {
    this.snapshots = []
    this.changes = []
    this.project = seedProject()
    this.persist(null)
  }

  private clip(id: string): Clip {
    const c = this.project.clips.find((x) => x.id === id)
    if (!c) throw new Error(`No clip with id "${id}". Call get_project to see the current clip ids.`)
    return c
  }

  private track(id: string): Track {
    const t = this.project.tracks.find((x) => x.id === id)
    if (!t) throw new Error(`No track with id "${id}". Tracks: ${this.project.tracks.map((x) => x.id).join(", ")}.`)
    return t
  }

  private newId(prefix: string) {
    let n = this.project.clips.length + 1
    while (this.project.clips.some((c) => c.id === `${prefix}${n}`)) n++
    return `${prefix}${n}`
  }

  private commit(op: string, summary: string, fn: (p: Project) => void) {
    const before = structuredClone(this.project)
    fn(this.project)
    this.project.duration = round(Math.max(0, ...this.project.clips.map((c) => c.start + c.duration)))
    for (const c of this.project.clips) {
      c.start = round(c.start)
      c.duration = round(c.duration)
      c.sourceOffset = round(c.sourceOffset)
    }
    this.snapshots.push(before)
    if (this.snapshots.length > 50) this.snapshots.shift()
    const change = { id: ++this.revision, at: new Date().toISOString(), op, summary }
    this.changes.push(change)
    this.persist(change)
    return change
  }

  private persist(change: Change | null) {
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.project, null, 2))
    }
    for (const l of this.listeners) l(this.get(), change)
  }

  undo(): Change {
    const prev = this.snapshots.pop()
    if (!prev) throw new Error("Nothing to undo.")
    this.project = prev
    const change = { id: ++this.revision, at: new Date().toISOString(), op: "undo", summary: "Reverted the last change" }
    this.changes.push(change)
    this.persist(change)
    return change
  }

  splitClip(clipId: string, at: number) {
    const c = this.clip(clipId)
    if (at <= c.start || at >= c.start + c.duration) {
      throw new Error(`Split point ${at}s must be inside ${c.name} (${c.start}s to ${round(c.start + c.duration)}s).`)
    }
    let rightId = ""
    this.commit("split_clip", `Split ${c.name} at ${at}s`, (p) => {
      const left = p.clips.find((x) => x.id === clipId)!
      const cut = at - left.start
      rightId = this.newId("c")
      const right: Clip = { ...left, id: rightId, start: at, duration: left.duration - cut, sourceOffset: left.sourceOffset + cut }
      left.duration = cut
      p.clips.push(right)
    })
    return { left: this.clip(clipId), right: this.clip(rightId) }
  }

  trimClip(clipId: string, opts: { start?: number; end?: number }) {
    const c = this.clip(clipId)
    const start = opts.start ?? c.start
    const end = opts.end ?? c.start + c.duration
    if (end - start < 0.1) throw new Error("A clip must stay at least 0.1s long.")
    if (start < c.start - c.sourceOffset) throw new Error(`Cannot extend ${c.name} before the start of its source media.`)
    const media = this.project.media[c.name]
    if (media && end - (c.start - c.sourceOffset) > media.duration + 1e-6) {
      throw new Error(`Cannot extend ${c.name} past the end of its source media (${media.duration}s).`)
    }
    this.commit("trim_clip", `Trimmed ${c.name} to ${round(start)}s-${round(end)}s`, (p) => {
      const x = p.clips.find((k) => k.id === clipId)!
      x.sourceOffset += start - x.start
      x.start = start
      x.duration = end - start
    })
    return this.clip(clipId)
  }

  moveClip(clipId: string, opts: { start?: number; trackId?: string }) {
    const c = this.clip(clipId)
    if (opts.trackId) {
      const t = this.track(opts.trackId)
      if (t.kind !== c.kind) throw new Error(`${c.name} is a ${c.kind} clip and cannot go on ${t.label} (${t.kind}).`)
    }
    if (opts.start !== undefined && opts.start < 0) throw new Error("Clips cannot start before 0s.")
    this.commit("move_clip", `Moved ${c.name} to ${opts.start ?? c.start}s${opts.trackId ? ` on ${opts.trackId}` : ""}`, (p) => {
      const x = p.clips.find((k) => k.id === clipId)!
      if (opts.start !== undefined) x.start = opts.start
      if (opts.trackId) x.trackId = opts.trackId
    })
    return this.clip(clipId)
  }

  deleteClip(clipId: string) {
    const c = this.clip(clipId)
    this.commit("delete_clip", `Deleted ${c.name}`, (p) => {
      p.clips = p.clips.filter((k) => k.id !== clipId)
    })
    return { deleted: c }
  }

  setVolume(clipId: string, volume: number) {
    const c = this.clip(clipId)
    if (c.kind === "text") throw new Error("Text clips have no volume.")
    if (volume < 0 || volume > 100) throw new Error("Volume is a percentage from 0 to 100.")
    this.commit("set_volume", `Set ${c.name} volume to ${volume}%`, (p) => {
      p.clips.find((k) => k.id === clipId)!.volume = volume
    })
    return this.clip(clipId)
  }

  addTextClip(opts: { text: string; start: number; duration: number; trackId?: string }) {
    const trackId = opts.trackId ?? "t1"
    const t = this.track(trackId)
    if (t.kind !== "text") throw new Error(`${t.label} is a ${t.kind} track; text needs a text track.`)
    if (opts.duration <= 0) throw new Error("Duration must be positive.")
    let id = ""
    this.commit("add_text", `Added text "${opts.text}" at ${opts.start}s`, (p) => {
      id = this.newId("c")
      p.clips.push({ id, name: opts.text, kind: "text", trackId, start: opts.start, duration: opts.duration, sourceOffset: 0 })
    })
    return this.clip(id)
  }

  ensureTrack(kind: ClipKind, label: string) {
    const existing = this.project.tracks.find((t) => t.label === label)
    if (existing) return existing
    const id = label.toLowerCase()
    this.commit("add_track", `Added track ${label}`, (p) => {
      p.tracks.push({ id, label, kind })
    })
    return this.track(id)
  }

  /** Transcript segments that fall inside a clip, expressed in timeline time. */
  transcribeClip(clipId: string): Segment[] {
    const c = this.clip(clipId)
    const timelineRange = { start: c.start, end: c.start + c.duration }
    const out: Segment[] = []
    for (const audio of this.project.clips.filter((k) => k.kind === "audio")) {
      const media = this.project.media[audio.name]
      if (!media?.transcript) continue
      for (const seg of media.transcript) {
        const s = audio.start + (seg.start - audio.sourceOffset)
        const e = audio.start + (seg.end - audio.sourceOffset)
        if (e <= audio.start || s >= audio.start + audio.duration) continue
        if (e <= timelineRange.start || s >= timelineRange.end) continue
        out.push({ start: round(Math.max(s, timelineRange.start)), end: round(Math.min(e, timelineRange.end)), text: seg.text })
      }
    }
    return out
  }

  detectBeats(trackId = "a2"): number[] {
    const music = this.project.clips.find((k) => k.trackId === trackId && k.kind === "audio")
    if (!music) throw new Error(`No audio clip on ${trackId}.`)
    const media = this.project.media[music.name]
    if (!media?.bpm) throw new Error(`${music.name} has no tempo information.`)
    const step = 60 / media.bpm
    const beats: number[] = []
    for (let t = music.start; t < music.start + music.duration; t += step) beats.push(round(t))
    return beats
  }

  /** Silences on the voice track, in timeline time. */
  findSilences(minDuration = 0.5, trackId = "a1"): Segment[] {
    const voice = this.project.clips.find((k) => k.trackId === trackId && k.kind === "audio")
    if (!voice) throw new Error(`No audio clip on ${trackId}.`)
    const media = this.project.media[voice.name]
    return (media?.silences ?? [])
      .map((s) => ({ start: round(voice.start + (s.start - voice.sourceOffset)), end: round(voice.start + (s.end - voice.sourceOffset)) }))
      .filter((s) => s.end - s.start >= minDuration && s.start >= voice.start && s.end <= voice.start + voice.duration)
  }

  /** Ripple-delete a range from every track: content inside is removed and everything after shifts left. */
  rippleDelete(rangeStart: number, rangeEnd: number) {
    if (rangeEnd <= rangeStart) throw new Error("Range end must be after range start.")
    const width = rangeEnd - rangeStart
    this.commit("ripple_delete", `Removed ${round(rangeStart)}s-${round(rangeEnd)}s from all tracks`, (p) => {
      const next: Clip[] = []
      for (const c of p.clips) {
        const cs = c.start
        const ce = c.start + c.duration
        if (ce <= rangeStart) {
          next.push(c)
        } else if (cs >= rangeEnd) {
          next.push({ ...c, start: cs - width })
        } else if (cs >= rangeStart && ce <= rangeEnd) {
          // fully inside the range: dropped
        } else if (cs < rangeStart && ce > rangeEnd) {
          const leftDur = rangeStart - cs
          next.push({ ...c, duration: leftDur })
          next.push({
            ...c,
            id: `${c.id}r`,
            start: rangeStart,
            duration: ce - rangeEnd,
            sourceOffset: c.sourceOffset + leftDur + width,
          })
        } else if (cs < rangeStart) {
          next.push({ ...c, duration: rangeStart - cs })
        } else {
          const cut = rangeEnd - cs
          next.push({ ...c, start: rangeStart, duration: c.duration - cut, sourceOffset: c.sourceOffset + cut })
        }
      }
      p.clips = next
    })
    return this.get()
  }

  removeSilences(minDuration = 0.5, trackId = "a1") {
    const silences = this.findSilences(minDuration, trackId)
    // remove from the end so earlier ranges stay valid
    for (const s of [...silences].sort((a, b) => b.start - a.start)) this.rippleDelete(s.start, s.end)
    return { removed: silences, project: this.get() }
  }

  /**
   * A line of speech that straddles a clip boundary is reported by both clips (clamped to
   * each), so fanning captioning out per clip yields the same text twice. Merge those back
   * into one caption spanning the full line.
   */
  private mergeCaptionSegments(segments: Segment[]): Segment[] {
    const sorted = [...segments].filter((s) => s.text).sort((a, b) => a.start - b.start)
    const out: Segment[] = []
    for (const seg of sorted) {
      const prev = out[out.length - 1]
      const sameLine = prev && prev.text === seg.text && seg.start <= prev.end + 0.05
      if (sameLine) prev.end = Math.max(prev.end, seg.end)
      else out.push({ ...seg })
    }
    return out
  }

  addCaptions(segments: Segment[], trackLabel = "T2") {
    const track = this.ensureTrack("text", trackLabel)
    const merged = this.mergeCaptionSegments(segments)
    const ids: string[] = []
    this.commit("add_captions", `Added ${merged.length} captions on ${track.label}`, (p) => {
      for (const seg of merged) {
        const id = this.newId("c")
        ids.push(id)
        p.clips.push({ id, name: seg.text!, kind: "text", trackId: track.id, start: seg.start, duration: Math.max(0.3, seg.end - seg.start), sourceOffset: 0 })
      }
    })
    return { track, clips: this.project.clips.filter((c) => ids.includes(c.id)) }
  }

  exportProject(format: string, resolution: string, dir: string): ExportRecord {
    const rec: ExportRecord = {
      id: `exp${this.project.exports.length + 1}`,
      format,
      resolution,
      createdAt: new Date().toISOString(),
      durationSeconds: this.project.duration,
      file: `${dir}/${this.project.name.replace(/\s+/g, "-").toLowerCase()}-${resolution}.${format}`,
    }
    this.commit("export_project", `Exported ${resolution} ${format}`, (p) => {
      p.exports.push(rec)
    })
    mkdirSync(dir, { recursive: true })
    writeFileSync(rec.file, JSON.stringify({ export: rec, project: this.project }, null, 2))
    return rec
  }
}
