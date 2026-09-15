// Messages exchanged between the page and the service worker. Shared by both builds, so no DOM or worker globals.

export type LogLevel = 'info' | 'warn' | 'error'

export interface WorkerLogEntry {
  /** Epoch milliseconds when the worker emitted the event. Delivery can lag, especially before a page is controlled. */
  time: number
  level: LogLevel
  event: string
  detail?: string
}

/** Page → worker. `sw:hello` expects a reply on the transferred MessagePort. */
export type ClientMessage = { type: 'sw:hello' }

/** Worker → page. */
export type WorkerMessage = { type: 'sw:log'; entry: WorkerLogEntry } | { type: 'sw:hello:reply'; version: string }

const LOG_LEVELS: ReadonlySet<string> = new Set<LogLevel>(['info', 'warn', 'error'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isClientMessage(value: unknown): value is ClientMessage {
  return isRecord(value) && value.type === 'sw:hello'
}

export function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'sw:log': {
      const entry = value.entry
      return (
        isRecord(entry) &&
        typeof entry.time === 'number' &&
        Number.isFinite(entry.time) &&
        typeof entry.level === 'string' &&
        LOG_LEVELS.has(entry.level) &&
        typeof entry.event === 'string' &&
        (entry.detail === undefined || typeof entry.detail === 'string')
      )
    }
    case 'sw:hello:reply':
      return typeof value.version === 'string'
    default:
      return false
  }
}
