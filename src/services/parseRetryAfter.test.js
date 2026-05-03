// parseRetryAfterMs tests.
//
// OpenAI's 429 error body includes a hint like "Please try again in 719ms"
// or "Please try again in 1.5s". This function extracts the wait time so
// callBackend can sleep the right amount before retrying.
//
// Caps:
//   - Min 200ms (no instant retries — server needs at least some breathing room)
//   - Max 10000ms (don't hang the eval run for 30s+ pathological cases)
//   - Default 2000ms when the message can't be parsed

import { describe, it, expect } from 'vitest'
import { parseRetryAfterMs } from './llmDeckService'

describe('parseRetryAfterMs — millisecond parsing', () => {
  it('parses "try again in 719ms"', () => {
    expect(parseRetryAfterMs('Rate limit. Please try again in 719ms.')).toBe(719)
  })

  it('parses "try again in 100ms" (small value)', () => {
    // Below the 200ms floor — should round up to 200.
    expect(parseRetryAfterMs('Please try again in 100ms')).toBe(200)
  })

  it('parses "try again in 5000ms"', () => {
    expect(parseRetryAfterMs('Please try again in 5000ms')).toBe(5000)
  })

  it('parses fractional ms (above floor)', () => {
    expect(parseRetryAfterMs('Please try again in 250.5ms')).toBe(250.5)
  })

  it('parses fractional ms (below floor) — clamped to floor', () => {
    expect(parseRetryAfterMs('Please try again in 123.5ms')).toBe(200)
  })
})

describe('parseRetryAfterMs — second parsing', () => {
  it('parses "try again in 2s"', () => {
    expect(parseRetryAfterMs('Please try again in 2s')).toBe(2000)
  })

  it('parses fractional seconds: "try again in 1.5s"', () => {
    expect(parseRetryAfterMs('Please try again in 1.5s')).toBe(1500)
  })

  it('parses "try again in 30s"', () => {
    // 30000ms exceeds 10000ms cap — should clamp to 10000.
    expect(parseRetryAfterMs('Please try again in 30s')).toBe(10000)
  })

  it('parses "try again in 0.5s" (rounds up to 500ms floor)', () => {
    expect(parseRetryAfterMs('Please try again in 0.5s')).toBe(500)
  })
})

describe('parseRetryAfterMs — caps and floors', () => {
  it('caps very large values at 10000ms', () => {
    expect(parseRetryAfterMs('Please try again in 60000ms')).toBe(10000)
    expect(parseRetryAfterMs('Please try again in 5m')).toBe(2000)  // unparseable "m" → default
  })

  it('floors very small ms values to 200ms', () => {
    expect(parseRetryAfterMs('Please try again in 50ms')).toBe(200)
    expect(parseRetryAfterMs('Please try again in 1ms')).toBe(200)
  })
})

describe('parseRetryAfterMs — defaults when unparseable', () => {
  it('returns DEFAULT_429_BACKOFF_MS (2000) when no time hint present', () => {
    expect(parseRetryAfterMs('Rate limit reached.')).toBe(2000)
    expect(parseRetryAfterMs('Some other error.')).toBe(2000)
  })

  it('returns default for null / undefined / non-string input', () => {
    expect(parseRetryAfterMs(null)).toBe(2000)
    expect(parseRetryAfterMs(undefined)).toBe(2000)
    expect(parseRetryAfterMs(42)).toBe(2000)
    expect(parseRetryAfterMs({ message: 'x' })).toBe(2000)
  })

  it('returns default for empty string', () => {
    expect(parseRetryAfterMs('')).toBe(2000)
  })
})

describe('parseRetryAfterMs — real OpenAI error message shapes', () => {
  it('parses the exact error format from production runs', () => {
    // From the user's eval JSON earlier today:
    const realErr = 'OpenAI returned 429: {\n    "error": {\n        "message": "Rate limit reached for gpt-4o-mini in organization org-xyz on tokens per min (TPM): Limit 200000, Used 193244, Requested 7168. Please try again in 123ms. Visit ...",\n        "type": "tokens"\n    }\n}'
    expect(parseRetryAfterMs(realErr)).toBe(200)   // 123ms floored to 200
  })

  it('parses 719ms case from a different production run', () => {
    const realErr = 'Rate limit reached for gpt-4o-mini in organization org-xyz on tokens per min (TPM): Limit 200000, Used 181004, Requested 21393. Please try again in 719ms.'
    expect(parseRetryAfterMs(realErr)).toBe(719)
  })
})
