import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

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
  /** Set once real bytes are on disk. File name inside the media dir. */
  file?: string
  width?: number
  height?: number
  fps?: number
  hasAudio?: boolean
  sizeBytes?: number
  /** Peak envelope over the whole file, 0..1, for the timeline waveform. */
  peaks?: number[]
  /** Where silences/peaks came from: absent means they were never measured. */
  analyzedAt?: string
}

export type ExportStatus = "pending" | "rendering" | "done" | "failed"

export type ExportRecord = {
  id: string
  format: string
  resolution: string
  width: number
  height: number
  fps: number
  createdAt: string
  durationSeconds: number
  file: string
  status: ExportStatus
  /** 0..1 while rendering. */
  progress?: number
  /** Real bytes on disk, only once status is "done". */
  sizeBytes?: number
  completedAt?: string
  error?: string
  /** When a worker took the job, and when it last showed a sign of life. */
  claimedAt?: string
  heartbeatAt?: string
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

/** The next id not already in `used`. Adds it to the set so callers can allocate in a loop. */
function allocateId(used: Set<string>, prefix = "c"): string {
  let n = used.size + 1
  while (used.has(`${prefix}${n}`)) n++
  const id = `${prefix}${n}`
  used.add(id)
  return id
}

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

/** A project with the standard track layout and nothing on it, for starting from real footage. */
export function emptyProject(): Project {
  return { ...seedProject(), clips: [], media: {}, duration: 0, exports: [] }
}

export class ProjectStore {
  private project: Project
  private snapshots: Project[] = []
  private changes: Change[] = []
  private listeners = new Set<(p: Project, change: Change | null) => void>()
  revision = 0

  constructor(
    private file?: string,
    /** Where media bytes live. Given, the store can tell a registered file from a present one. */
    private mediaDir?: string,
  ) {
    this.project = file && existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Project) : seedProject()
  }

  /** Media is only usable once its bytes are actually on disk, not merely named. */
  hasBytes(name: string): boolean {
    const info = this.project.media[name]
    if (!info?.file) return false
    return this.mediaDir ? existsSync(join(this.mediaDir, info.file)) : true
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

  reset(opts: { empty?: boolean } = {}) {
    this.snapshots = []
    this.changes = []
    this.project = opts.empty ? emptyProject() : seedProject()
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

  private newId(prefix = "c") {
    return allocateId(new Set(this.project.clips.map((c) => c.id)), prefix)
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
      // Ids must stay unique across every split this pass makes: a clip that spans the range is
      // cut in two, and removeSilences ripples repeatedly over the same long clips.
      const used = new Set(p.clips.map((c) => c.id))
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
            id: allocateId(used),
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

  // ---- real media -----------------------------------------------------------

  /**
   * Record media whose bytes are on disk. Metadata is measured by the editor (WebCodecs)
   * rather than guessed here, so the agent server needs no ffprobe of its own.
   */
  registerMedia(name: string, info: Omit<MediaInfo, "silences" | "transcript" | "peaks">): MediaInfo {
    if (!name.trim()) throw new Error("Media needs a name.")
    this.commit("import_media", `Imported ${name} (${round(info.duration)}s)`, (p) => {
      p.media[name] = { ...p.media[name], ...info }
    })
    return this.project.media[name]!
  }

  /** Attach measurements taken from the decoded audio: silences, peak envelope, tempo. */
  setMediaAnalysis(name: string, analysis: { silences?: Segment[]; peaks?: number[]; bpm?: number; transcript?: Segment[] }): MediaInfo {
    const media = this.project.media[name]
    if (!media) throw new Error(`No media named "${name}".`)
    const counted = analysis.silences ? `${analysis.silences.length} silences` : "waveform"
    this.commit("analyze_media", `Analyzed ${name}: ${counted}`, (p) => {
      p.media[name] = { ...p.media[name]!, ...analysis, analyzedAt: new Date().toISOString() }
    })
    return this.project.media[name]!
  }

  /** Put imported media on the timeline. Unlike addTextClip this needs a real source file. */
  addClip(opts: { name: string; trackId: string; start: number; duration?: number; sourceOffset?: number }): Clip {
    const track = this.track(opts.trackId)
    if (track.kind === "text") throw new Error(`${track.label} is a text track; use add_text instead.`)
    const media = this.project.media[opts.name]
    if (!media) throw new Error(`No media named "${opts.name}". Call list_media to see what has been imported.`)
    if (!this.hasBytes(opts.name)) throw new Error(`"${opts.name}" has no media on disk yet, so it cannot be placed on the timeline.`)
    const sourceOffset = opts.sourceOffset ?? 0
    if (sourceOffset < 0 || sourceOffset >= media.duration) {
      throw new Error(`sourceOffset ${sourceOffset}s is outside ${opts.name} (0s to ${media.duration}s).`)
    }
    const duration = opts.duration ?? media.duration - sourceOffset
    if (duration <= 0) throw new Error("Duration must be positive.")
    if (sourceOffset + duration > media.duration + 1e-6) {
      throw new Error(`${opts.name} only has ${round(media.duration - sourceOffset)}s left after a ${sourceOffset}s offset.`)
    }
    if (opts.start < 0) throw new Error("Clips cannot start before 0s.")
    let id = ""
    this.commit("add_clip", `Added ${opts.name} at ${round(opts.start)}s on ${track.label}`, (p) => {
      id = this.newId("c")
      p.clips.push({
        id,
        name: opts.name,
        kind: track.kind,
        trackId: track.id,
        start: opts.start,
        duration,
        sourceOffset,
        ...(track.kind === "audio" ? { volume: 100 } : {}),
      })
    })
    return this.clip(id)
  }

  // ---- export ---------------------------------------------------------------

  /**
   * Queue a render. The encode happens in the editor, which owns the decoders, so this
   * only creates the job; the file appears when the editor posts the bytes back.
   */
  requestExport(format: string, resolution: string, dir: string): ExportRecord {
    assertRenderTarget(format, resolution)
    const missing = this.missingMedia()
    if (missing.length > 0) {
      throw new Error(
        `Cannot render: ${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no media on disk. ` +
          `Import real footage first, or remove those clips.`,
      )
    }
    const { width, height } = resolutionToSize(resolution)
    const used = new Set(this.project.exports.map((e) => e.id))
    let n = this.project.exports.length + 1
    while (used.has(`exp${n}`)) n++
    const rec: ExportRecord = {
      id: `exp${n}`,
      format,
      resolution,
      width,
      height,
      fps: this.project.fps,
      createdAt: new Date().toISOString(),
      durationSeconds: this.project.duration,
      file: join(dir, `${slug(this.project.name)}-${resolution}-exp${n}.${format}`),
      status: "pending",
      progress: 0,
    }
    mkdirSync(dir, { recursive: true })
    // The render must be of the timeline as it was approved, not of whatever it has become by
    // the time an editor picks the job up, so the project is frozen here beside the job.
    writeFileSync(snapshotPath(rec), JSON.stringify(this.project, null, 2))
    this.commit("export_project", `Queued a ${resolution} ${format} render`, (p) => {
      p.exports.push(rec)
    })
    return rec
  }

  /** The timeline as it stood when a render was queued. */
  exportSnapshot(id: string): Project {
    const rec = this.getExport(id)
    const path = snapshotPath(rec)
    if (!existsSync(path)) throw new Error(`Export ${id} has no snapshot; it cannot be rendered faithfully.`)
    return JSON.parse(readFileSync(path, "utf8")) as Project
  }

  /** Clips whose source media has no bytes on disk. Nothing can be rendered from those. */
  missingMedia(): string[] {
    const names = new Set<string>()
    for (const c of this.project.clips) {
      if (c.kind === "text") continue
      if (!this.hasBytes(c.name)) names.add(c.name)
    }
    return [...names]
  }

  getExport(id: string): ExportRecord {
    const rec = this.project.exports.find((e) => e.id === id)
    if (!rec) throw new Error(`No export with id "${id}".`)
    return structuredClone(rec)
  }

  /** The oldest render an editor could take: never started, or abandoned mid-flight. */
  pendingExport(): ExportRecord | null {
    return structuredClone(this.project.exports.find(isClaimable) ?? null)
  }

  private updateExport(id: string, fn: (rec: ExportRecord) => void, op: string, summary: string) {
    if (!this.project.exports.some((e) => e.id === id)) throw new Error(`No export with id "${id}".`)
    this.commit(op, summary, (p) => {
      fn(p.exports.find((e) => e.id === id)!)
    })
    return this.getExport(id)
  }

  /**
   * Take a queued render. Returns null if it is already claimed, which is how two editors
   * open on the same project avoid both encoding it: only one claim can win.
   */
  claimExport(id: string): ExportRecord | null {
    const rec = this.project.exports.find((e) => e.id === id)
    if (!rec || !isClaimable(rec)) return null
    const retry = rec.status === "rendering"
    const now = new Date().toISOString()
    return this.updateExport(
      id,
      (r) => {
        r.status = "rendering"
        r.progress = 0
        r.claimedAt = now
        r.heartbeatAt = now
      },
      "export_claimed",
      retry ? `Reclaimed abandoned render ${id}` : `Started rendering ${id}`,
    )
  }

  /** Queued, or claimed by a worker that has gone quiet for longer than the lease. */
  claimableExports(): ExportRecord[] {
    return this.project.exports.filter(isClaimable).map((e) => structuredClone(e))
  }

  setExportProgress(id: string, progress: number) {
    // A finished render must not be reopened by a straggling progress report.
    const current = this.getExport(id)
    if (current.status !== "rendering") return current
    const clamped = Math.max(0, Math.min(1, progress))
    return this.updateExport(
      id,
      (rec) => {
        rec.progress = clamped
        rec.heartbeatAt = new Date().toISOString()
      },
      "export_progress",
      `Rendering ${id}: ${Math.round(clamped * 100)}%`,
    )
  }

  /**
   * Finish a render whose bytes are already on disk at `uploadedPath`.
   *
   * A path rather than a buffer: a 4K render is gigabytes, and reading it into the server only
   * to write it out again would be the one place this design needs the whole file in memory.
   */
  completeExport(id: string, uploadedPath: string) {
    const rec = this.getExport(id)
    if (!existsSync(uploadedPath)) throw new Error(`No uploaded file at ${uploadedPath}.`)
    // Moved before the commit: commit notifies subscribers synchronously, and a client that
    // reacts to the finished export must not find the file missing.
    mkdirSync(dirname(rec.file), { recursive: true })
    renameSync(uploadedPath, rec.file)
    const sizeBytes = statSync(rec.file).size
    // The snapshot exists so an abandoned render can be retried faithfully. Done is terminal,
    // so it has nothing left to serve.
    const snapshot = snapshotPath(rec)
    if (existsSync(snapshot)) unlinkSync(snapshot)
    return this.updateExport(
      id,
      (r) => {
        r.status = "done"
        r.progress = 1
        r.sizeBytes = sizeBytes
        r.completedAt = new Date().toISOString()
        delete r.error
      },
      "export_done",
      `Rendered ${rec.resolution} ${rec.format} (${(sizeBytes / 1e6).toFixed(1)} MB)`,
    )
  }

  failExport(id: string, error: string) {
    // Same reason: a late failure from a losing worker must not bury a finished file.
    const current = this.getExport(id)
    if (current.status === "done") return current
    return this.updateExport(
      id,
      (rec) => {
        rec.status = "failed"
        rec.error = error
      },
      "export_failed",
      `Render ${id} failed: ${error}`,
    )
  }
}

/**
 * How long a claimed render may go silent before another editor may take it over.
 *
 * Without this a tab that is closed mid-render strands the job in `rendering` forever: only
 * the worker that claimed it can report failure, and it is gone.
 */
export const RENDER_LEASE_MS = 60_000

export function isClaimable(rec: ExportRecord, now = Date.now()): boolean {
  if (rec.status === "pending") return true
  if (rec.status !== "rendering") return false
  const last = Date.parse(rec.heartbeatAt ?? rec.claimedAt ?? rec.createdAt)
  return Number.isFinite(last) && now - last > RENDER_LEASE_MS
}

const snapshotPath = (rec: ExportRecord) => `${rec.file}.project.json`

/** Render sizes are 16:9, matching the editor's preview. */
const SIZES: Record<string, { width: number; height: number }> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "4k": { width: 3840, height: 2160 },
}

const FORMATS = new Set(["mp4", "webm"])

export function resolutionToSize(resolution: string): { width: number; height: number } {
  const size = SIZES[resolution]
  if (!size) throw new Error(`Unknown resolution "${resolution}". Use one of: ${Object.keys(SIZES).join(", ")}.`)
  return size
}

/**
 * Both of these end up inside the output path. The MCP tool constrains them with zod, but the
 * HTTP route does not, and `join` happily normalizes `../` out of a directory, so they are
 * checked against the allowed sets here where the path is actually built.
 */
function assertRenderTarget(format: string, resolution: string) {
  if (!FORMATS.has(format)) throw new Error(`Unknown format "${format}". Use one of: ${[...FORMATS].join(", ")}.`)
  resolutionToSize(resolution)
}

/** The project name is part of the file name, so it is reduced to a safe slug. */
function slug(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "-").toLowerCase()
  return cleaned.slice(0, 60) || "project"
}
