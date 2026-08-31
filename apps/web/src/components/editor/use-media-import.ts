import { useCallback, useState } from "react"
import { decodeAudioFile, detectSilences, estimateTempo, forgetAudio, peakEnvelope } from "#/engine/audio"
import { probeFile, uploadMedia } from "#/engine/media"
import { videoCache } from "#/engine/video-cache"
import { agentJson } from "#/lib/agent"

export type ImportState = { name: string; stage: "probing" | "uploading" | "analyzing" | "done" | "failed"; error?: string }

/**
 * Import real footage: measure it, hand the bytes to the agent, then measure its audio so the
 * agent's silence, waveform and tempo answers come from the file rather than from a fixture.
 */
export function useMediaImport() {
  const [imports, setImports] = useState<ImportState[]>([])

  const update = useCallback((name: string, patch: Partial<ImportState>) => {
    setImports((list) => list.map((i) => (i.name === name ? { ...i, ...patch } : i)))
  }, [])

  const importFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setImports((list) => [...list.filter((i) => !files.some((f) => f.name === i.name)), ...files.map((f) => ({ name: f.name, stage: "probing" as const }))])

      for (const file of files) {
        try {
          const probe = await probeFile(file)
          if (!probe.canDecode) throw new Error(`This browser cannot decode ${probe.codec ?? "that codec"}.`)

          update(file.name, { stage: "uploading" })
          const { name } = await uploadMedia(file, probe)
          // The bytes changed under this name, so anything decoded from the old ones is stale.
          videoCache.clear(name)
          forgetAudio(name)

          if (probe.hasAudio) {
            update(file.name, { stage: "analyzing" })
            const buffer = await decodeAudioFile(file)
            if (buffer) {
              await agentJson(`/media/${encodeURIComponent(name)}/analysis`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  silences: detectSilences(buffer),
                  peaks: peakEnvelope(buffer),
                  bpm: estimateTempo(buffer) ?? undefined,
                }),
              })
            }
          }
          update(file.name, { stage: "done" })
        } catch (err) {
          update(file.name, { stage: "failed", error: err instanceof Error ? err.message : String(err) })
        }
      }
    },
    [update],
  )

  const dismiss = useCallback((name: string) => setImports((list) => list.filter((i) => i.name !== name)), [])

  return { imports, importFiles, dismiss }
}
