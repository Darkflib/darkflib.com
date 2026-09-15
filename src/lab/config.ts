// Fault Lab configuration, from /lab/config.json. Deployment supplies the origins (and the CSP must admit them);
// the test server supplies local stand-ins and shorter timings.

export type LabTargetId = 'api-primary' | 'api-secondary' | 'media'

export interface LabTarget {
  id: LabTargetId
  label: string
  origin: string
  path: string
}

export interface ClientTuning {
  /** Whether the status client polls at all. Off, the panel shows the lab idle and no request is made. */
  enabled: boolean
  /** Pause between the end of one status cycle and the start of the next. */
  pollIntervalMs: number
  /** Per-attempt timeout. */
  requestTimeoutMs: number
  /** Retries after the first attempt, for retryable failures. */
  maxRetries: number
  /** Exponential backoff with full jitter: a random delay up to min(cap, base * 2^retry). */
  backoffBaseMs: number
  backoffCapMs: number
  /** A Retry-After up to this long is waited out; a longer one opens the circuit until it has passed. */
  maxRetryAfterMs: number
  /** Consecutive failed calls (after retries) that open a target's circuit. */
  circuitThreshold: number
  /** How long an open circuit refuses calls before allowing one trial. */
  circuitOpenMs: number
}

export interface LabConfig {
  client: ClientTuning
  targets: Record<LabTargetId, LabTarget>
}

const TARGET_IDS: readonly LabTargetId[] = ['api-primary', 'api-secondary', 'media']
const TUNING_KEYS: readonly Exclude<keyof ClientTuning, 'enabled'>[] = [
  'pollIntervalMs',
  'requestTimeoutMs',
  'maxRetries',
  'backoffBaseMs',
  'backoffCapMs',
  'maxRetryAfterMs',
  'circuitThreshold',
  'circuitOpenMs',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function loadLabConfig(): Promise<LabConfig> {
  const response = await fetch('/lab/config.json', { cache: 'no-cache' })
  if (!response.ok) throw new Error(`/lab/config.json returned ${response.status}`)
  const raw: unknown = await response.json()
  if (!isRecord(raw) || !isRecord(raw.client) || !Array.isArray(raw.targets)) throw new Error('malformed lab config')

  if (raw.client.enabled !== undefined && typeof raw.client.enabled !== 'boolean')
    throw new Error('lab config: bad enabled')
  const client = { enabled: raw.client.enabled !== false } as ClientTuning
  for (const key of TUNING_KEYS) {
    const value = raw.client[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`lab config: bad ${key}`)
    client[key] = value
  }

  const targets = {} as Record<LabTargetId, LabTarget>
  for (const entry of raw.targets) {
    if (
      !isRecord(entry) ||
      !TARGET_IDS.includes(entry.id as LabTargetId) ||
      typeof entry.label !== 'string' ||
      typeof entry.origin !== 'string' ||
      typeof entry.path !== 'string'
    ) {
      throw new Error('lab config: bad target')
    }
    if (new URL(entry.origin).origin !== entry.origin) throw new Error(`lab config: ${entry.origin} is not an origin`)
    targets[entry.id as LabTargetId] = entry as unknown as LabTarget
  }
  for (const id of TARGET_IDS) if (!targets[id]) throw new Error(`lab config: missing ${id}`)
  return { client, targets }
}
