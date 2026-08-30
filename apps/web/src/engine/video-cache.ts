import { CanvasSink, type WrappedCanvas } from "mediabunny"
import { inputFor } from "./media"

type SinkData = {
  sink: CanvasSink
  iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null
  currentFrame: WrappedCanvas | null
  nextFrame: WrappedCanvas | null
  lastTime: number
  prefetching: boolean
  prefetchPromise: Promise<void> | null
}

/** Seeking is expensive; playing forward is not. Within this many seconds ahead, decode through. */
const ITERATE_AHEAD_SECONDS = 2

/**
 * Decoded frames for the preview, one decoder per media file.
 *
 * Ported from OpenCut's video cache. The shape matters: a naive `getCanvas(t)` per frame
 * re-seeks the decoder every time and plays back at a few frames a second. Instead a forward
 * iterator is kept open and the next frame is decoded ahead of being asked for, so ordinary
 * playback never seeks, and a scrub falls back to a real seek only when the target is behind
 * the head or too far in front of it.
 */
export class VideoCache {
  private sinks = new Map<string, SinkData>()
  private initPromises = new Map<string, Promise<void>>()
  /** Frame requests for one media must not interleave: they share a single decoder. */
  private frameChain = new Map<string, Promise<unknown>>()
  private seekGenerations = new Map<string, number>()

  async getFrameAt(name: string, time: number): Promise<WrappedCanvas | null> {
    await this.ensureSink(name)
    const sinkData = this.sinks.get(name)
    if (!sinkData) return null

    // A newer request supersedes an older one: the old one resolves with whatever is current
    // rather than dragging the decoder back to a timestamp nobody is looking at any more.
    const generation = (this.seekGenerations.get(name) ?? 0) + 1
    this.seekGenerations.set(name, generation)

    const previous = this.frameChain.get(name) ?? Promise.resolve()
    const current = previous.then(() => {
      if (this.seekGenerations.get(name) !== generation) return sinkData.currentFrame
      return this.resolveFrame(sinkData, time)
    })
    this.frameChain.set(
      name,
      current.catch(() => {}),
    )
    return current
  }

  clear(name?: string) {
    const names = name ? [name] : [...this.sinks.keys()]
    for (const key of names) {
      void this.sinks.get(key)?.iterator?.return()
      this.sinks.delete(key)
      this.initPromises.delete(key)
      this.frameChain.delete(key)
      this.seekGenerations.delete(key)
    }
  }

  private async resolveFrame(sinkData: SinkData, time: number): Promise<WrappedCanvas | null> {
    if (sinkData.nextFrame && sinkData.nextFrame.timestamp <= time) {
      sinkData.currentFrame = sinkData.nextFrame
      sinkData.nextFrame = null
      this.startPrefetch(sinkData)
    }

    if (sinkData.currentFrame && isFrameValid(sinkData.currentFrame, time)) {
      this.startPrefetch(sinkData)
      return sinkData.currentFrame
    }

    if (sinkData.iterator && sinkData.currentFrame && time >= sinkData.lastTime && time < sinkData.lastTime + ITERATE_AHEAD_SECONDS) {
      const frame = await this.iterateToTime(sinkData, time)
      if (frame) {
        this.startPrefetch(sinkData)
        return frame
      }
    }

    const frame = await this.seekToTime(sinkData, time)
    if (frame) this.startPrefetch(sinkData)
    return frame
  }

  private async iterateToTime(sinkData: SinkData, targetTime: number): Promise<WrappedCanvas | null> {
    if (!sinkData.iterator) return null
    try {
      while (true) {
        if (sinkData.prefetching && sinkData.prefetchPromise) await sinkData.prefetchPromise

        if (sinkData.nextFrame && sinkData.nextFrame.timestamp <= targetTime + 0.05) {
          sinkData.currentFrame = sinkData.nextFrame
          sinkData.nextFrame = null
        } else {
          const { value: frame, done } = await sinkData.iterator.next()
          if (done || !frame) break
          sinkData.currentFrame = frame
        }

        const frame = sinkData.currentFrame
        if (!frame) break
        sinkData.lastTime = frame.timestamp
        if (isFrameValid(frame, targetTime)) return frame
        if (frame.timestamp > targetTime + 1) break
      }
    } catch (error) {
      console.warn("[editai] frame iterator failed, will re-seek:", error)
      sinkData.iterator = null
    }
    return null
  }

  private async seekToTime(sinkData: SinkData, time: number): Promise<WrappedCanvas | null> {
    try {
      if (sinkData.prefetching && sinkData.prefetchPromise) await sinkData.prefetchPromise
      if (sinkData.iterator) {
        await sinkData.iterator.return()
        sinkData.iterator = null
      }
      sinkData.nextFrame = null
      sinkData.iterator = sinkData.sink.canvases(time)
      sinkData.lastTime = time
      const { value: frame } = await sinkData.iterator.next()
      if (frame) {
        sinkData.currentFrame = frame
        return frame
      }
    } catch (error) {
      console.warn("[editai] failed to seek video:", error)
    }
    return null
  }

  private startPrefetch(sinkData: SinkData) {
    if (sinkData.prefetching || !sinkData.iterator || sinkData.nextFrame) return
    sinkData.prefetching = true
    sinkData.prefetchPromise = this.prefetchNextFrame(sinkData)
  }

  private async prefetchNextFrame(sinkData: SinkData): Promise<void> {
    if (!sinkData.iterator) {
      sinkData.prefetching = false
      sinkData.prefetchPromise = null
      return
    }
    try {
      const { value: frame, done } = await sinkData.iterator.next()
      if (!done && frame) sinkData.nextFrame = frame
    } catch (error) {
      console.warn("[editai] prefetch failed:", error)
      sinkData.iterator = null
    } finally {
      sinkData.prefetching = false
      sinkData.prefetchPromise = null
    }
  }

  private ensureSink(name: string): Promise<void> {
    const existing = this.initPromises.get(name)
    if (existing) return existing
    const promise = (async () => {
      const track = await inputFor(name).getPrimaryVideoTrack()
      if (!track) throw new Error(`${name} has no video track.`)
      if (!(await track.canDecode())) throw new Error(`This browser cannot decode ${name} (${track.codec ?? "unknown codec"}).`)
      this.sinks.set(name, {
        sink: new CanvasSink(track, { poolSize: 2 }),
        iterator: null,
        currentFrame: null,
        nextFrame: null,
        lastTime: 0,
        prefetching: false,
        prefetchPromise: null,
      })
    })()
    // A failed init must not be cached, or the media can never recover.
    this.initPromises.set(
      name,
      promise.catch((err) => {
        this.initPromises.delete(name)
        throw err
      }),
    )
    return this.initPromises.get(name)!
  }
}

const isFrameValid = (frame: WrappedCanvas, time: number) => time >= frame.timestamp && time < frame.timestamp + frame.duration

export const videoCache = new VideoCache()
