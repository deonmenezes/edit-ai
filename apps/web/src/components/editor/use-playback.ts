import { useCallback, useEffect, useRef, useState } from "react"
import { clamp } from "./data"

export function usePlayback(duration: number) {
  const [time, setTimeState] = useState(0)
  const [playing, setPlaying] = useState(false)
  const timeRef = useRef(0)
  const frame = useRef<number | null>(null)

  const setTime = useCallback(
    (t: number) => {
      const next = clamp(t, 0, duration)
      timeRef.current = next
      setTimeState(next)
    },
    [duration],
  )

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const step = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const next = timeRef.current + dt
      if (next >= duration) {
        setTime(duration)
        setPlaying(false)
        return
      }
      setTime(next)
      frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [playing, duration, setTime])

  const toggle = useCallback(() => {
    if (!playing && timeRef.current >= duration) setTime(0)
    setPlaying((p) => !p)
  }, [playing, duration, setTime])

  const seek = useCallback((t: number) => setTime(t), [setTime])
  const nudge = useCallback((dt: number) => setTime(timeRef.current + dt), [setTime])

  return { time, playing, toggle, seek, nudge, setPlaying }
}
