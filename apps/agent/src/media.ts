import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { basename, dirname, extname, join } from "node:path"
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

export type ByteRange = { start: number; end: number }

/**
 * Parse one HTTP byte range against a known size.
 *
 * The suffix form matters: `bytes=-500` means the *last* 500 bytes, not the first 500. Reading
 * it as a start offset hands a decoder the head of the file when it asked for the tail, which
 * is exactly where an mp4 keeps the index in a non-faststart file.
 */
export function parseRange(header: string | undefined, size: number): ByteRange | "unsatisfiable" | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return "unsatisfiable"

  if (!rawStart) {
    const suffix = Number(rawEnd)
    if (suffix === 0) return "unsatisfiable"
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(rawStart)
  const end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1
  if (start >= size || end < start) return "unsatisfiable"
  return { start, end }
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

/** Collect a bounded request body. Used for render chunks, which are capped by the writer. */
export function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    let size = 0
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        req.destroy()
        reject(new Error(`Chunk exceeds ${maxBytes} bytes.`))
        return
      }
      parts.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(parts)))
    req.on("error", reject)
  })
}

/** Write a chunk at its byte offset, creating the file if this is the first one. */
export function writeChunkAt(path: string, position: number, data: Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  const fd = openSync(path, existsSync(path) ? "r+" : "w+")
  try {
    writeSync(fd, data, 0, data.length, position)
  } finally {
    closeSync(fd)
  }
}
