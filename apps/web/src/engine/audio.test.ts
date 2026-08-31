import { describe, expect, test } from "vitest"
import { detectSilences, estimateTempo, peakEnvelope } from "./audio"

const SAMPLE_RATE = 48000

/**
 * The analyzers only read `sampleRate` and channel 0, so a plain Float32Array standing in for
 * an AudioBuffer exercises the real code without a WebAudio implementation in the test env.
 */
function buffer(samples: Float32Array): AudioBuffer {
  return { sampleRate: SAMPLE_RATE, length: samples.length, duration: samples.length / SAMPLE_RATE, numberOfChannels: 1, getChannelData: () => samples } as unknown as AudioBuffer
}

/** A tone with silent gaps, the same shape as the sample voiceover. */
function tone(durationSeconds: number, gaps: { start: number; end: number }[]): AudioBuffer {
  const samples = new Float32Array(Math.round(durationSeconds * SAMPLE_RATE))
  for (let i = 0; i < samples.length; i++) {
    const t = i / SAMPLE_RATE
    samples[i] = gaps.some((g) => t >= g.start && t < g.end) ? 0 : 0.4 * Math.sin(2 * Math.PI * 220 * t)
  }
  return buffer(samples)
}

describe("detectSilences", () => {
  test("finds the gaps that are really there", () => {
    const gaps = [
      { start: 1, end: 2 },
      { start: 4.5, end: 5.4 },
    ]
    const found = detectSilences(tone(8, gaps))
    expect(found).toHaveLength(2)
    expect(found[0]!.start).toBeCloseTo(1, 1)
    expect(found[0]!.end).toBeCloseTo(2, 1)
    expect(found[1]!.start).toBeCloseTo(4.5, 1)
  })

  test("ignores gaps shorter than the minimum", () => {
    expect(detectSilences(tone(4, [{ start: 1, end: 1.2 }]), { minDuration: 0.5 })).toEqual([])
  })

  test("room tone below the threshold still counts as silence", () => {
    const samples = new Float32Array(SAMPLE_RATE * 3)
    for (let i = 0; i < samples.length; i++) {
      const t = i / SAMPLE_RATE
      // -60 dBFS hiss between 1s and 2s: quiet, but nowhere near zero.
      samples[i] = t >= 1 && t < 2 ? 0.001 * Math.sin(2 * Math.PI * 3000 * t) : 0.4 * Math.sin(2 * Math.PI * 220 * t)
    }
    const found = detectSilences(buffer(samples))
    expect(found).toHaveLength(1)
    expect(found[0]!.start).toBeCloseTo(1, 1)
  })

  test("audio with no gaps has no silences", () => {
    expect(detectSilences(tone(5, []))).toEqual([])
  })
})

describe("peakEnvelope", () => {
  test("tracks amplitude across the file", () => {
    const samples = new Float32Array(SAMPLE_RATE * 2)
    // Quiet first half, loud second half.
    for (let i = 0; i < samples.length; i++) samples[i] = (i < samples.length / 2 ? 0.1 : 0.9) * Math.sin(i)
    const peaks = peakEnvelope(buffer(samples), 10)
    expect(peaks).toHaveLength(10)
    expect(peaks[0]!).toBeLessThan(0.2)
    expect(peaks[9]!).toBeGreaterThan(0.8)
    expect(Math.max(...peaks)).toBeLessThanOrEqual(1)
  })
})

describe("estimateTempo", () => {
  test("recovers the tempo of a click track", () => {
    const seconds = 16
    const bpm = 120
    const samples = new Float32Array(SAMPLE_RATE * seconds)
    for (let i = 0; i < samples.length; i++) {
      const t = i / SAMPLE_RATE
      const sinceBeat = t % (60 / bpm)
      samples[i] = 0.9 * Math.sin(2 * Math.PI * 760 * t) * Math.exp(-26 * sinceBeat)
    }
    // Octave errors are the usual failure of autocorrelation; accept the beat or its double.
    const found = estimateTempo(buffer(samples))
    expect([bpm, bpm * 2, bpm / 2]).toContain(found)
  })

  test("silence has no tempo", () => {
    expect(estimateTempo(buffer(new Float32Array(SAMPLE_RATE * 4)))).toBeNull()
  })

  test("audio too short to hold a beat returns nothing", () => {
    expect(estimateTempo(buffer(new Float32Array(256)))).toBeNull()
  })
})
