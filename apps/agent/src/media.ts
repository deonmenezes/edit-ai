import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { basename, extname, join } from "node:path"
import type { IncomingMessage } from "node:http"
import { pipeline } from "node:stream/promises"

/** 2 GiB. Enough for real footage, small enough that a runaway upload cannot fill the disk. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".m4v": "video/mp4",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
}

export const mimeFor = (name: string) => MIME[extname(name).toLowerCase()] ?? "application/octet-stream"

/**
 * Media names come from the browser and end up as paths, so they are reduced to a bare
 * file name. `basename` alone is not enough: a name is also used as a project key, and
 * "..", an empty string or a leading dot would each produce a path that is not a file
 * inside the media dir.
 */
export function safeMediaName(raw: string): string {
  const name = basename(String(raw ?? "").trim()).replace(/[/\\]/g, "")
  if (!name || name === "." || name === "..") throw new Error("Media name is not a usable file name.")
  if (name.startsWith(".")) throw new Error("Media name cannot start with a dot.")
  if (name.length > 200) throw new Error("Media name is too long.")
  return name
}

/** Stream a request body to disk, refusing anything over the cap. */
export async function saveUpload(req: IncomingMessage, dir: string, name: string): Promise<number> {
  mkdirSync(dir, { recursive: true })
  const target = join(dir, name)
  // Unique: two uploads of the same name must not write through one another's temp file.
  const tmp = `${target}.${randomUUID()}.part`
  let bytes = 0
  let tooBig = false
  req.on("data", (chunk: Buffer) => {
    bytes += chunk.length
    if (bytes > MAX_UPLOAD_BYTES && !tooBig) {
      tooBig = true
      req.destroy(new Error(`Upload exceeds ${MAX_UPLOAD_BYTES} bytes.`))
    }
  })
  try {
    await pipeline(req, createWriteStream(tmp))
  } catch (err) {
    if (existsSync(tmp)) unlinkSync(tmp)
    throw err
  }
  if (bytes === 0) {
    unlinkSync(tmp)
    throw new Error("Upload was empty.")
  }
  // Rename last so a reader never sees a half-written file under the real name.
  renameSync(tmp, target)
  return statSync(target).size
}
