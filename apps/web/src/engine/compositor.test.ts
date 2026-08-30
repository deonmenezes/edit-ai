import { describe, expect, test } from "vitest"
import type { Project } from "#/components/editor/data"
import { audibleClips } from "./audio"
import { clipsAtTime, sourceTimeFor } from "./compositor"

const project: Project = {
  name: "test",
  fps: 30,
  duration: 20,
  tracks: [
    { id: "v1", label: "V1", kind: "video" },
    { id: "t1", label: "T1", kind: "text" },
    { id: "a1", label: "A1", kind: "audio" },
  ],
  clips: [
    { id: "c1", name: "a.mp4", kind: "video", trackId: "v1", start: 0, duration: 5, sourceOffset: 2 },
    { id: "c2", name: "b.mp4", kind: "video", trackId: "v1", start: 5, duration: 5, sourceOffset: 0 },
    { id: "c3", name: "Title", kind: "text", trackId: "t1", start: 1, duration: 3, sourceOffset: 0 },
    { id: "c4", name: "vo.wav", kind: "audio", trackId: "a1", start: 0, duration: 20, sourceOffset: 0, volume: 100 },
    { id: "c5", name: "muted.wav", kind: "audio", trackId: "a1", start: 0, duration: 20, sourceOffset: 0, volume: 0 },
  ],
  media: {
    "a.mp4": { duration: 30, width: 1920, height: 1080, hasAudio: true, file: "a.mp4" },
    "b.mp4": { duration: 30, width: 1920, height: 1080, hasAudio: false, file: "b.mp4" },
    "vo.wav": { duration: 30, hasAudio: true, file: "vo.wav" },
    "muted.wav": { duration: 30, hasAudio: true, file: "muted.wav" },
  },
}

describe("clipsAtTime", () => {
  test("a clip is live from its start up to but not including its end", () => {
    expect(clipsAtTime(project, 0).map((c) => c.id)).toEqual(["c1", "c4", "c5"])
    expect(clipsAtTime(project, 5).map((c) => c.id)).toContain("c2")
    expect(clipsAtTime(project, 5).map((c) => c.id)).not.toContain("c1")
  })

  test("overlapping tracks are all live at once", () => {
    expect(clipsAtTime(project, 2).map((c) => c.id).sort()).toEqual(["c1", "c3", "c4", "c5"])
  })

  test("past the end of the timeline nothing is live", () => {
    expect(clipsAtTime(project, 25)).toEqual([])
  })
})

describe("sourceTimeFor", () => {
  test("a trimmed clip reads from its source offset", () => {
    const clip = project.clips[0]!
    expect(sourceTimeFor(clip, 0)).toBe(2)
    expect(sourceTimeFor(clip, 3)).toBe(5)
  })

  test("a clip that starts later on the timeline still reads from its own offset", () => {
    expect(sourceTimeFor(project.clips[1]!, 7)).toBe(2)
  })
})

describe("audibleClips", () => {
  test("silent video and muted audio contribute nothing to the mix", () => {
    const ids = audibleClips(project).map((c) => c.id)
    expect(ids).toContain("c1") // video whose source has audio
    expect(ids).toContain("c4")
    expect(ids).not.toContain("c2") // video with no audio track
    expect(ids).not.toContain("c5") // volume 0
    expect(ids).not.toContain("c3") // text
  })
})
