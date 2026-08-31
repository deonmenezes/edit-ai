import { describe, expect, test } from "bun:test"
import { isClaimable, ProjectStore, RENDER_LEASE_MS } from "../src/project.ts"
import { parseRange, safeMediaName } from "../src/media.ts"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const EXPORT_DIR = join(tmpdir(), "editai-test-exports")

/** Stand in for a render the editor has already streamed to disk. */
function uploaded(bytes: Uint8Array): string {
  mkdirSync(EXPORT_DIR, { recursive: true })
  const path = join(EXPORT_DIR, `upload-${randomUUID()}`)
  writeFileSync(path, bytes)
  return path
}

describe("ProjectStore", () => {
  test("split keeps media in sync", () => {
    const s = new ProjectStore()
    const { left, right } = s.splitClip("c3", 15)
    expect(left.duration).toBe(4)
    expect(right.start).toBe(15)
    expect(right.duration).toBe(9)
    expect(right.sourceOffset).toBe(4)
  })

  test("trim start moves the source offset", () => {
    const s = new ProjectStore()
    const c = s.trimClip("c1", { start: 1 })
    expect(c.start).toBe(1)
    expect(c.duration).toBe(4)
    expect(c.sourceOffset).toBe(1)
  })

  test("trim cannot extend past the source media", () => {
    const s = new ProjectStore()
    expect(() => s.trimClip("c1", { end: 6 })).toThrow(/source media/)
  })

  test("ripple delete closes the gap on every track", () => {
    const s = new ProjectStore()
    const before = new Set(s.get().clips.map((c) => c.id))
    const p = s.rippleDelete(3, 4)

    // intro.mp4 spans the removed range, so it is cut in two and the second half is a new clip.
    const intro = p.clips.find((c) => c.id === "c1")!
    const introRight = p.clips.find((c) => c.name === "intro.mp4" && !before.has(c.id))!
    expect(intro.duration).toBe(3)
    expect(introRight.start).toBe(3)
    expect(introRight.duration).toBe(1)
    expect(introRight.sourceOffset).toBe(4)

    // everything that started after the range shifts left by its width
    expect(p.clips.find((c) => c.id === "c2")!.start).toBe(4)
    expect(p.duration).toBe(23)

    // a clip that only overlaps the start of the range is just shortened
    const hook = p.clips.find((c) => c.id === "c4")!
    expect(hook.start).toBe(0.5)
    expect(hook.duration).toBe(2.5)
  })

  test("remove silences removes each detected silence", () => {
    const s = new ProjectStore()
    const before = s.get().duration
    const { removed, project } = s.removeSilences(0.5)
    expect(removed.length).toBe(3)
    const total = removed.reduce((a, r) => a + (r.end - r.start), 0)
    expect(project.duration).toBeCloseTo(before - total, 3)
  })

  test("transcribe returns only segments inside the clip", () => {
    const s = new ProjectStore()
    const segs = s.transcribeClip("c2")
    expect(segs.every((x) => x.start >= 5 && x.end <= 11)).toBe(true)
    expect(segs.length).toBeGreaterThan(0)
  })

  test("captions land on a new text track", () => {
    const s = new ProjectStore()
    const { track, clips } = s.addCaptions(s.transcribeClip("c3"))
    expect(track.label).toBe("T2")
    expect(clips.length).toBeGreaterThan(0)
    expect(clips.every((c) => c.trackId === track.id && c.kind === "text")).toBe(true)
  })

  test("undo restores the previous state", () => {
    const s = new ProjectStore()
    s.deleteClip("c2")
    expect(s.get().clips.find((c) => c.id === "c2")).toBeUndefined()
    s.undo()
    expect(s.get().clips.find((c) => c.id === "c2")).toBeDefined()
  })

  test("beats follow the tempo", () => {
    const s = new ProjectStore()
    const beats = s.detectBeats("a2")
    expect(beats[0]).toBe(0)
    expect(beats[1]).toBe(0.5)
    expect(beats.length).toBe(48)
  })
})

describe("caption merging", () => {
  test("a line split across two clips becomes one caption", () => {
    const s = new ProjectStore()
    // What two sub-agents return for a line straddling the c1/c2 boundary at 5s.
    const { clips } = s.addCaptions([
      { start: 4.2, end: 5, text: "EditAI reads your timeline." },
      { start: 5, end: 7.5, text: "EditAI reads your timeline." },
      { start: 7.6, end: 9.5, text: "Silences, captions, pacing." },
    ])
    expect(clips.length).toBe(2)
    expect(clips[0]!.start).toBe(4.2)
    expect(clips[0]!.duration).toBe(3.3)
    expect(clips[1]!.name).toBe("Silences, captions, pacing.")
  })

  test("identical text far apart stays separate", () => {
    const s = new ProjectStore()
    const { clips } = s.addCaptions([
      { start: 1, end: 2, text: "Subscribe" },
      { start: 20, end: 21, text: "Subscribe" },
    ])
    expect(clips.length).toBe(2)
  })

  test("segments without text are dropped", () => {
    const s = new ProjectStore()
    const { clips } = s.addCaptions([{ start: 1, end: 2, text: "Keep" }, { start: 3, end: 4 } as never])
    expect(clips.length).toBe(1)
  })
})

describe("clip ids stay unique", () => {
  test("repeated ripple deletes over one clip never reuse an id", () => {
    const s = new ProjectStore()
    // The voiceover spans the whole timeline, so all three silences cut the same clip.
    s.removeSilences(0.5)
    const ids = s.get().clips.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("every clip a range splits gets its own fresh id", () => {
    const s = new ProjectStore()
    const before = new Set(s.get().clips.map((c) => c.id))
    // 2s-3s falls inside intro.mp4, the hook title, the voiceover and the music.
    const p = s.rippleDelete(2, 3)
    const added = p.clips.filter((c) => !before.has(c.id))
    expect(added).toHaveLength(4)
    expect(new Set(p.clips.map((c) => c.id)).size).toBe(p.clips.length)
  })

  test("a clip deleted after a ripple resolves to one clip", () => {
    const s = new ProjectStore()
    s.removeSilences(0.5)
    const target = s.get().clips.filter((c) => c.trackId === "a1")[1]!
    s.deleteClip(target.id)
    expect(s.get().clips.some((c) => c.id === target.id)).toBe(false)
  })
})

describe("trim respects the source media after a split", () => {
  // A review flagged `end - (c.start - c.sourceOffset)` as the wrong bound. It is not: the
  // expression expands to `c.sourceOffset + (end - c.start)`, the source time at `end`. These
  // tests pin the boundary so the correct form is not "fixed" into a broken one later.
  test("a trimmed clip may extend to exactly the end of its media", () => {
    const s = new ProjectStore()
    s.splitClip("c3", 16) // talking-head.mp4: 13s of media, right half starts at 16 with offset 5
    const right = s.get().clips.find((c) => c.start === 16 && c.name === "talking-head.mp4")!
    expect(right.sourceOffset).toBe(5)
    expect(s.trimClip(right.id, { end: 24 }).duration).toBe(8)
  })

  test("but not one frame past it", () => {
    const s = new ProjectStore()
    s.splitClip("c3", 16)
    const right = s.get().clips.find((c) => c.start === 16 && c.name === "talking-head.mp4")!
    expect(() => s.trimClip(right.id, { end: 24.5 })).toThrow(/source media/)
  })
})

describe("real media", () => {
  /** No media dir given, so registered media counts as present: file-system checks are covered separately. */
  const withMedia = () => {
    const s = new ProjectStore()
    s.reset({ empty: true })
    s.registerMedia("clip.mp4", { duration: 12, file: "clip.mp4", width: 1920, height: 1080, fps: 30, hasAudio: true })
    return s
  }

  test("an empty project starts with tracks but nothing on them", () => {
    const s = new ProjectStore()
    s.reset({ empty: true })
    expect(s.get().clips).toEqual([])
    expect(s.get().media).toEqual({})
    expect(s.get().duration).toBe(0)
  })

  test("registering media records what was measured", () => {
    const s = withMedia()
    expect(s.get().media["clip.mp4"]).toMatchObject({ duration: 12, width: 1920, hasAudio: true })
    expect(s.hasBytes("clip.mp4")).toBe(true)
  })

  test("a clip defaults to the rest of the file", () => {
    const s = withMedia()
    const clip = s.addClip({ name: "clip.mp4", trackId: "v1", start: 2, sourceOffset: 4 })
    expect(clip.duration).toBe(8)
    expect(clip.start).toBe(2)
    expect(s.get().duration).toBe(10)
  })

  test("a clip cannot run past the end of its source", () => {
    const s = withMedia()
    expect(() => s.addClip({ name: "clip.mp4", trackId: "v1", start: 0, sourceOffset: 8, duration: 6 })).toThrow(/only has 4s/)
  })

  test("media that was never imported cannot be placed", () => {
    const s = withMedia()
    expect(() => s.addClip({ name: "ghost.mp4", trackId: "v1", start: 0 })).toThrow(/No media named/)
  })

  test("audio cannot be placed on a text track", () => {
    const s = withMedia()
    expect(() => s.addClip({ name: "clip.mp4", trackId: "t1", start: 0 })).toThrow(/text track/)
  })

  test("analysis attaches measurements to the media", () => {
    const s = withMedia()
    s.setMediaAnalysis("clip.mp4", { silences: [{ start: 1, end: 2 }], peaks: [0.1, 0.9], bpm: 120 })
    const media = s.get().media["clip.mp4"]!
    expect(media.silences).toEqual([{ start: 1, end: 2 }])
    expect(media.bpm).toBe(120)
    expect(media.analyzedAt).toBeTruthy()
  })
})

describe("export lifecycle", () => {
  const ready = () => {
    const s = new ProjectStore()
    s.reset({ empty: true })
    s.registerMedia("clip.mp4", { duration: 10, file: "clip.mp4", width: 1920, height: 1080 })
    s.addClip({ name: "clip.mp4", trackId: "v1", start: 0 })
    return s
  }

  test("a render is queued, not written", () => {
    const rec = ready().requestExport("mp4", "1080p", EXPORT_DIR)
    expect(rec.status).toBe("pending")
    expect(rec.width).toBe(1920)
    expect(rec.sizeBytes).toBeUndefined()
  })

  test("resolution decides the frame size", () => {
    const s = ready()
    expect(s.requestExport("mp4", "720p", EXPORT_DIR)).toMatchObject({ width: 1280, height: 720 })
    expect(s.requestExport("mp4", "4k", EXPORT_DIR)).toMatchObject({ width: 3840, height: 2160 })
  })

  test("the sample timeline cannot be rendered until real media is imported", () => {
    const s = new ProjectStore()
    expect(s.missingMedia().sort()).toEqual(["b-roll.mp4", "intro.mp4", "music.mp3", "talking-head.mp4", "voiceover.wav"])
    expect(() => s.requestExport("mp4", "1080p", EXPORT_DIR)).toThrow(/no media on disk/)
  })

  test("only one worker can claim a render", () => {
    const s = ready()
    const rec = s.requestExport("mp4", "1080p", EXPORT_DIR)
    expect(s.claimExport(rec.id)?.status).toBe("rendering")
    expect(s.claimExport(rec.id)).toBeNull()
  })

  test("a finished render is not reopened by a late progress or failure report", () => {
    const s = ready()
    const rec = s.requestExport("mp4", "1080p", EXPORT_DIR)
    s.claimExport(rec.id)
    s.completeExport(rec.id, uploaded(new Uint8Array([1, 2, 3, 4])))
    expect(s.getExport(rec.id)).toMatchObject({ status: "done", sizeBytes: 4 })
    s.setExportProgress(rec.id, 0.5)
    s.failExport(rec.id, "too late")
    expect(s.getExport(rec.id)).toMatchObject({ status: "done", sizeBytes: 4 })
  })

  test("a failed render keeps its error", () => {
    const s = ready()
    const rec = s.requestExport("mp4", "1080p", EXPORT_DIR)
    s.claimExport(rec.id)
    expect(s.failExport(rec.id, "codec unsupported")).toMatchObject({ status: "failed", error: "codec unsupported" })
  })
})

describe("render safety", () => {
  const ready = () => {
    const s = new ProjectStore()
    s.reset({ empty: true })
    s.registerMedia("clip.mp4", { duration: 10, file: "clip.mp4", width: 1920, height: 1080 })
    s.addClip({ name: "clip.mp4", trackId: "v1", start: 0 })
    return s
  }

  test("format and resolution cannot escape the exports directory", () => {
    const s = ready()
    // These become path components, and join() would normalize the traversal away.
    expect(() => s.requestExport("mp4", "../../../outside", EXPORT_DIR)).toThrow(/Unknown resolution/)
    expect(() => s.requestExport("../../evil", "1080p", EXPORT_DIR)).toThrow(/Unknown format/)
    expect(s.requestExport("mp4", "1080p", EXPORT_DIR).file.startsWith(EXPORT_DIR)).toBe(true)
  })

  test("the project name cannot escape it either", () => {
    const s = ready()
    s.get() // touch, then rename through the persisted model
    const store = new ProjectStore()
    store.reset({ empty: true })
    store.registerMedia("clip.mp4", { duration: 10, file: "clip.mp4" })
    store.addClip({ name: "clip.mp4", trackId: "v1", start: 0 })
    const rec = store.requestExport("mp4", "1080p", EXPORT_DIR)
    expect(rec.file.startsWith(join(EXPORT_DIR, "untitled-project"))).toBe(true)
  })

  test("a render keeps the timeline it was queued from", () => {
    const s = ready()
    const rec = s.requestExport("mp4", "1080p", EXPORT_DIR)
    const before = s.exportSnapshot(rec.id)
    s.addClip({ name: "clip.mp4", trackId: "v1", start: 10 })
    expect(s.get().clips).toHaveLength(2)
    // The queued render is still of the one-clip timeline the user approved.
    expect(s.exportSnapshot(rec.id).clips).toHaveLength(1)
    expect(before.duration).toBe(10)
  })

  test("an abandoned render can be reclaimed once its lease expires", () => {
    const s = ready()
    const rec = s.requestExport("mp4", "1080p", EXPORT_DIR)
    const claimed = s.claimExport(rec.id)!
    expect(s.claimExport(rec.id)).toBeNull()

    expect(isClaimable(claimed, Date.parse(claimed.heartbeatAt!) + 1000)).toBe(false)
    expect(isClaimable(claimed, Date.parse(claimed.heartbeatAt!) + RENDER_LEASE_MS + 1)).toBe(true)
  })

  test("progress keeps the lease alive", () => {
    const s = ready()
    const rec = s.requestExport("mp4", "1080p", EXPORT_DIR)
    const claimed = s.claimExport(rec.id)!
    const beat = s.setExportProgress(rec.id, 0.5)
    expect(Date.parse(beat.heartbeatAt!)).toBeGreaterThanOrEqual(Date.parse(claimed.heartbeatAt!))
  })

  test("a finished render is terminal, not claimable", () => {
    const s = ready()
    const rec = s.requestExport("mp4", "1080p", EXPORT_DIR)
    s.claimExport(rec.id)
    const done = s.completeExport(rec.id, uploaded(new Uint8Array([1, 2, 3])))
    expect(isClaimable(done, Date.now() + RENDER_LEASE_MS * 10)).toBe(false)
  })
})

describe("parseRange", () => {
  test("a suffix range returns the end of the file, not the start", () => {
    expect(parseRange("bytes=-500", 5000)).toEqual({ start: 4500, end: 4999 })
  })

  test("an open-ended range runs to the last byte", () => {
    expect(parseRange("bytes=100-", 5000)).toEqual({ start: 100, end: 4999 })
  })

  test("a closed range is clamped to the file", () => {
    expect(parseRange("bytes=100-99999", 5000)).toEqual({ start: 100, end: 4999 })
    expect(parseRange("bytes=0-99", 5000)).toEqual({ start: 0, end: 99 })
  })

  test("a suffix longer than the file returns the whole file", () => {
    expect(parseRange("bytes=-99999", 5000)).toEqual({ start: 0, end: 4999 })
  })

  test("nonsense and out-of-bounds ranges are rejected", () => {
    expect(parseRange(undefined, 5000)).toBeNull()
    expect(parseRange("items=0-10", 5000)).toBeNull()
    expect(parseRange("bytes=5000-", 5000)).toBe("unsatisfiable")
    expect(parseRange("bytes=-0", 5000)).toBe("unsatisfiable")
    expect(parseRange("bytes=-", 5000)).toBe("unsatisfiable")
  })
})

describe("safeMediaName", () => {
  test("strips any path from a name", () => {
    expect(safeMediaName("../../etc/passwd")).toBe("passwd")
    expect(safeMediaName("clip.mp4")).toBe("clip.mp4")
  })

  test("rejects names that are not usable files", () => {
    expect(() => safeMediaName("")).toThrow()
    expect(() => safeMediaName("..")).toThrow()
    expect(() => safeMediaName(".hidden")).toThrow()
  })
})
