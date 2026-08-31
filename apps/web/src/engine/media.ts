import { ALL_FORMATS, BlobSource, Input, UrlSource } from "mediabunny"
import { agentJson, mediaUrl } from "#/lib/agent"

export type Probe = {
  duration: number
  width?: number
  height?: number
  fps?: number
  hasAudio: boolean
  hasVideo: boolean
  /** False when the browser has no decoder for this codec, which export would hit later. */
  canDecode: boolean
  codec: string | null
}

/**
 * Inputs are opened over HTTP range requests rather than downloaded, so seeking a large
 * file costs a couple of requests instead of the whole file. One per media name, kept for
 * the life of the page: a decoder's own caches are what make scrubbing fast.
 */
const inputs = new Map<string, Input>()

export function inputFor(name: string): Input {
  const existing = inputs.get(name)
  if (existing) return existing
  const input = new Input({ source: new UrlSource(mediaUrl(name)), formats: ALL_FORMATS })
  inputs.set(name, input)
  return input
}

/** Drop a media's decoder, e.g. after it is re-imported under the same name. */
export function forgetMedia(name: string) {
  inputs.delete(name)
}

/** Measure a file the user picked, before it is uploaded. */
export async function probeFile(file: File): Promise<Probe> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  const [duration, videoTrack, audioTrack] = await Promise.all([
    input.computeDuration(),
    input.getPrimaryVideoTrack(),
    input.getPrimaryAudioTrack(),
  ])
  if (!videoTrack && !audioTrack) throw new Error(`${file.name} has no video or audio track.`)
  const canDecode = videoTrack ? await videoTrack.canDecode() : audioTrack ? await audioTrack.canDecode() : false
  return {
    duration,
    width: videoTrack?.displayWidth,
    height: videoTrack?.displayHeight,
    fps: videoTrack ? ((await videoTrack.computePacketStats(120)).averagePacketRate ?? undefined) : undefined,
    hasAudio: Boolean(audioTrack),
    hasVideo: Boolean(videoTrack),
    canDecode,
    codec: videoTrack?.codec ?? audioTrack?.codec ?? null,
  }
}

/** Upload the bytes and register the measurements. The agent stores both. */
export async function uploadMedia(file: File, probe: Probe): Promise<{ name: string }> {
  const params = new URLSearchParams({ duration: String(probe.duration), hasAudio: String(probe.hasAudio) })
  if (probe.width) params.set("width", String(Math.round(probe.width)))
  if (probe.height) params.set("height", String(Math.round(probe.height)))
  if (probe.fps) params.set("fps", String(Math.round(probe.fps * 1000) / 1000))
  const result = await agentJson<{ name: string }>(`/media/${encodeURIComponent(file.name)}?${params}`, {
    method: "POST",
    body: file,
    headers: { "content-type": file.type || "application/octet-stream" },
  })
  forgetMedia(result.name)
  return result
}
