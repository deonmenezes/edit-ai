/**
 * Start work nobody is waiting for, without letting a rejection escape unhandled.
 *
 * The `void` operator would do the same thing more tersely and is banned by the repo's
 * conventions, but it also drops rejections on the floor, which this does not.
 */
export function fireAndForget(promise: Promise<unknown> | undefined, onError?: (error: unknown) => void): void {
  promise?.catch((error: unknown) => {
    if (onError) onError(error)
    else console.warn("[editai] background task failed:", error)
  })
}
