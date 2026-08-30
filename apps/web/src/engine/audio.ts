import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny"
import { mediaUrl } from "#/lib/agent"
import type { Project } from "#/components/editor/data"
import { inputFor } from "./media"

/** 48 kHz stereo is what the AAC/Opus encoders want anyway. */
export const EXPORT_SAMPLE_RATE = 48000

let sharedContext: AudioContext | null = null

/** One context for the page. Created suspended; playback resumes it on a user gesture. */
export function audioContext(): AudioContext {
  if (!sharedContext) sharedContext = new AudioContext({ sampleRate: EXPORT_SAMPLE_RATE })
  return sharedContext
}

const decoded = new Map<string, Promise<AudioBuffer | null>>()

/**
 * Whole-file audio, decoded once per media.
 *
 * `decodeAudioData` is the fast path and handles mp4/mp3/wav, but it refuses containers the
 * browser will not demux (some .mov, .mkv). mediabunny can demux those, so it decodes the
 * track packet by packet and the pieces are stitched back together.
 */
export function decodeAudio(name: string): Promise<AudioBuffer | null> {
  const existing = decoded.get(name)
  if (existing) return existing
  const promise = decodeAudioUncached(name).catch((err) => {
    decoded.delete(name)
    throw err
  })
  decoded.set(name, promise)
  return promise
}

export function forgetAudio(name?: string) {
  if (name) decoded.delete(name)
  else decoded.clear()
}

async function decodeAudioUncached(name: string): Promise<AudioBuffer | null> {
  const ctx = audioContext()
  try {
    const res = await fetch(mediaUrl(name))
    if (!res.ok) throw new Error(`Could not fetch ${name}: ${res.status}`)
    return await ctx.decodeAudioData(await res.arrayBuffer())
  } catch {
    return await decodeViaMediabunny(inputFor(name), ctx)
  }
}

/** Same decode for a file the user just picked, before it has been uploaded. */
export async function decodeAudioFile(file: File): Promise<AudioBuffer | null> {
  const ctx = audioContext()
  try {
    return await ctx.decodeAudioData(await file.arrayBuffer())
  } catch {
    return await decodeViaMediabunny(new Input({ source: new BlobSource(file), formats: ALL_FORMATS }), ctx)
  }
}

async function decodeViaMediabunny(input: Input, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
  const track = await input.getPrimaryAudioTrack()
  if (!track || !(await track.canDecode())) return null
  const sink = new AudioBufferSink(track)
  const chunks: { buffer: AudioBuffer; timestamp: number }[] = []
  let channels = 0
  let sampleRate = 0
  let end = 0
  for await (const wrapped of sink.buffers()) {
    chunks.push({ buffer: wrapped.buffer, timestamp: wrapped.timestamp })
    channels = Math.max(channels, wrapped.buffer.numberOfChannels)
    sampleRate = sampleRate || wrapped.buffer.sampleRate
    end = Math.max(end, wrapped.timestamp + wrapped.buffer.duration)
  }
  if (chunks.length === 0) return null
  const out = ctx.createBuffer(channels, Math.ceil(end * sampleRate), sampleRate)
  for (const { buffer, timestamp } of chunks) {
    const offset = Math.round(timestamp * sampleRate)
    for (let c = 0; c < channels; c++) {
      // A mono chunk in a stereo file feeds every output channel.
      const source = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1))
      const target = out.getChannelData(c)
      const count = Math.min(source.length, target.length - offset)
      if (count > 0) target.set(source.subarray(0, count), offset)
    }
  }
  return out
}

/** Clips that contribute audio: the audio tracks, plus video whose source has sound. */
export function audibleClips(project: Project) {
  return project.clips.filter((c) => {
    if (c.kind === "text") return false
    if ((c.volume ?? 100) <= 0) return false
    if (c.kind === "audio") return true
    return project.media?.[c.name]?.hasAudio === true
  })
}

/**
 * The whole timeline mixed to one buffer: every clip placed at its start, read from its
 * source offset, scaled by its volume. This is both what the preview plays and what the
 * exporter muxes, so the two can never drift apart.
 */
export async function mixTimeline(project: Project, duration = project.duration): Promise<AudioBuffer | null> {
  const clips = audibleClips(project)
  if (clips.length === 0 || duration <= 0) return null

  const ctx = audioContext()
  const sampleRate = EXPORT_SAMPLE_RATE
  const length = Math.ceil(duration * sampleRate)
  const out = ctx.createBuffer(2, length, sampleRate)
  const left = out.getChannelData(0)
  const right = out.getChannelData(1)

  const sources = await Promise.all(
    clips.map(async (clip) => ({ clip, buffer: await decodeAudio(clip.name).catch(() => null) })),
  )

  for (const { clip, buffer } of sources) {
    if (!buffer) continue
    const gain = (clip.volume ?? 100) / 100
    const ratio = buffer.sampleRate / sampleRate
    const startSample = Math.round(clip.start * sampleRate)
    const count = Math.min(Math.round(clip.duration * sampleRate), length - startSample)
    if (count <= 0) continue
    const sourceStart = (clip.sourceOffset ?? 0) * buffer.sampleRate
    const l = buffer.getChannelData(0)
    const r = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : l

    for (let i = 0; i < count; i++) {
      // Nearest-sample read. Sources are decoded at their own rate, and every real file we
      // accept is 44.1k or 48k, so the error is under a sample period.
      const s = Math.round(sourceStart + i * ratio)
      if (s < 0 || s >= l.length) continue
      left[startSample + i]! += l[s]! * gain
      right[startSample + i]! += r[s]! * gain
    }
  }

  limit(left)
  limit(right)
  return out
}

/** Summing tracks can exceed full scale; scale the whole channel back rather than clip it. */
function limit(channel: Float32Array) {
  let peak = 0
  for (let i = 0; i < channel.length; i++) {
    const abs = Math.abs(channel[i]!)
    if (abs > peak) peak = abs
  }
  if (peak <= 1) return
  const scale = 1 / peak
  for (let i = 0; i < channel.length; i++) channel[i]! *= scale
}

export type SilenceRange = { start: number; end: number }

/**
 * Silent ranges measured from the decoded audio, in source seconds.
 *
 * Windowed RMS rather than a per-sample threshold: a single zero crossing is not silence,
 * and room tone sits well above zero but well below speech.
 */
export function detectSilences(
  buffer: AudioBuffer,
  { minDuration = 0.5, thresholdDb = -45, windowMs = 20 }: { minDuration?: number; thresholdDb?: number; windowMs?: number } = {},
): SilenceRange[] {
  const threshold = 10 ** (thresholdDb / 20)
  const windowSize = Math.max(1, Math.round((windowMs / 1000) * buffer.sampleRate))
  const data = buffer.getChannelData(0)
  const ranges: SilenceRange[] = []
  let runStart: number | null = null

  for (let i = 0; i < data.length; i += windowSize) {
    const end = Math.min(i + windowSize, data.length)
    let sum = 0
    for (let j = i; j < end; j++) sum += data[j]! * data[j]!
    const quiet = Math.sqrt(sum / (end - i)) < threshold
    if (quiet && runStart === null) runStart = i
    if (!quiet && runStart !== null) {
      pushRange(ranges, runStart / buffer.sampleRate, i / buffer.sampleRate, minDuration)
      runStart = null
    }
  }
  if (runStart !== null) pushRange(ranges, runStart / buffer.sampleRate, data.length / buffer.sampleRate, minDuration)
  return ranges
}

function pushRange(ranges: SilenceRange[], start: number, end: number, minDuration: number) {
  if (end - start < minDuration) return
  ranges.push({ start: round(start), end: round(end) })
}

/** Peak envelope for the timeline waveform: `count` buckets of max amplitude, 0..1. */
export function peakEnvelope(buffer: AudioBuffer, count = 400): number[] {
  const data = buffer.getChannelData(0)
  const peaks = new Array<number>(count).fill(0)
  const per = data.length / count
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * per)
    const end = Math.min(Math.floor((i + 1) * per), data.length)
    let peak = 0
    for (let j = start; j < end; j++) {
      const abs = Math.abs(data[j]!)
      if (abs > peak) peak = abs
    }
    peaks[i] = round(peak)
  }
  return peaks
}

const round = (n: number) => Math.round(n * 1000) / 1000

/**
 * Tempo, estimated from the onset envelope.
 *
 * Energy is summed in short hops, the rising part of its difference is the onset strength,
 * and the lag whose autocorrelation peaks over a musical range of periods is the beat. Good
 * enough to cut to; it will not track a song that changes tempo.
 */
export function estimateTempo(buffer: AudioBuffer, { minBpm = 60, maxBpm = 180 }: { minBpm?: number; maxBpm?: number } = {}): number | null {
  const hop = Math.round(buffer.sampleRate * 0.01)
  const data = buffer.getChannelData(0)
  const frames = Math.floor(data.length / hop)
  if (frames < 128) return null

  const energy = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let i = f * hop; i < (f + 1) * hop; i++) sum += data[i]! * data[i]!
    energy[f] = Math.sqrt(sum / hop)
  }

  const onset = new Float32Array(frames)
  let mean = 0
  for (let f = 1; f < frames; f++) {
    onset[f] = Math.max(0, energy[f]! - energy[f - 1]!)
    mean += onset[f]!
  }
  mean /= frames
  if (mean <= 0) return null
  for (let f = 0; f < frames; f++) onset[f]! -= mean

  const framesPerSecond = buffer.sampleRate / hop
  const minLag = Math.floor((60 / maxBpm) * framesPerSecond)
  const maxLag = Math.ceil((60 / minBpm) * framesPerSecond)
  let bestLag = 0
  let best = 0
  for (let lag = minLag; lag <= maxLag && lag < frames; lag++) {
    let sum = 0
    for (let f = lag; f < frames; f++) sum += onset[f]! * onset[f - lag]!
    const score = sum / (frames - lag)
    if (score > best) {
      best = score
      bestLag = lag
    }
  }
  if (!bestLag || best <= 0) return null
  return Math.round((60 * framesPerSecond) / bestLag)
}
