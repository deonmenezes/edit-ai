import { describe, expect, test } from "bun:test"
import { ProjectStore } from "../src/project.ts"

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
