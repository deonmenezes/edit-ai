import type { ExportRecord } from "./data"

/**
 * How long a claimed render may go silent before another editor may take it over. Must match
 * RENDER_LEASE_MS in apps/agent; the server is the authority, this only avoids pointless claims.
 */
export const RENDER_LEASE_MS = 60_000

/** Queued, or claimed by a worker that has gone quiet: either way, free to pick up. */
export function isClaimable(rec: ExportRecord, now = Date.now()): boolean {
  if (rec.status === "pending") return true
  if (rec.status !== "rendering") return false
  const last = Date.parse(rec.heartbeatAt ?? rec.claimedAt ?? rec.createdAt)
  return Number.isFinite(last) && now - last > RENDER_LEASE_MS
}
