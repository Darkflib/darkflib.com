// Fault Lab control: turns the panel's choices into worker rules, and treats the worker's acknowledgement as the truth
// about what is active. Rules live only in the worker's memory for this tab, so a worker restart or replacement loses
// them; a request batch from a different worker instance than the one that acknowledged reveals that, and the rules
// are sent again.
import type { FaultRule } from '../sw/protocol'
import {
  getServiceWorkerSnapshot,
  recordEvent,
  type ServiceWorkerSnapshot,
  subscribeServiceWorker,
  supports,
} from '../telemetry/serviceWorker'
import type { LabConfig, LabTargetId } from './config'

export type FaultChoice = 'none' | 'offline' | 'latency' | 'http-503' | 'http-429'

export interface FaultSpec {
  choice: FaultChoice
  latencyMs: number
  probability: number
  retryAfterSeconds: number
}

export const DEFAULT_SPEC: FaultSpec = { choice: 'none', latencyMs: 800, probability: 1, retryAfterSeconds: 2 }

export interface FaultControlState {
  specs: Partial<Record<LabTargetId, FaultSpec>>
  /** Rules the worker acknowledged holding for this tab. */
  applied: readonly FaultRule[]
  /** The worker instance that acknowledged them. */
  appliedBy: string | null
  rejected: readonly { origin: string; reason: string }[]
  pending: boolean
  error: string | null
}

let state: FaultControlState = { specs: {}, applied: [], appliedBy: null, rejected: [], pending: false, error: null }
const listeners = new Set<() => void>()

function publish(patch: Partial<FaultControlState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function getFaultControlState(): FaultControlState {
  return state
}

export function subscribeFaultControl(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export type Availability = { ok: true } | { ok: false; reason: string }

/** Whether this tab can inject faults, and if not, why. */
export function faultLabAvailability(worker: ServiceWorkerSnapshot): Availability {
  if (worker.registration === 'unsupported')
    return { ok: false, reason: 'Service workers are unavailable in this browser.' }
  if (worker.registration === 'disabled') return { ok: false, reason: 'The service worker is disabled (?sw=off).' }
  if (worker.registration === 'failed') return { ok: false, reason: 'The service worker failed to register.' }
  if (!worker.controlled) return { ok: false, reason: 'Waiting for the service worker to control this page.' }
  if (worker.controllerCapabilities === null) return { ok: false, reason: 'Checking what the service worker supports…' }
  if (!supports(worker, 'fault-injection')) {
    return {
      ok: false,
      reason:
        'This tab is controlled by an older service worker without fault injection. It updates once every darkflib.com tab has closed, or when you upgrade it from the SERVICE_WORKER panel.',
    }
  }
  return { ok: true }
}

function toRule(origin: string, spec: FaultSpec): FaultRule | null {
  const base = { origin, probability: spec.probability }
  switch (spec.choice) {
    case 'none':
      return null
    case 'offline':
      return { ...base, mode: 'offline' }
    case 'latency':
      return { ...base, mode: 'latency', latencyMs: spec.latencyMs }
    case 'http-503':
      return { ...base, mode: 'status', status: 503, retryAfterSeconds: spec.retryAfterSeconds }
    case 'http-429':
      return { ...base, mode: 'status', status: 429, retryAfterSeconds: spec.retryAfterSeconds }
  }
}

function rulesFor(config: LabConfig, specs: FaultControlState['specs']): FaultRule[] {
  return (Object.keys(specs) as LabTargetId[])
    .map((id) => toRule(config.targets[id].origin, specs[id] as FaultSpec))
    .filter((rule): rule is FaultRule => rule !== null)
}

function describeRule(rule: FaultRule): string {
  const host = new URL(rule.origin).host
  const share = rule.probability < 1 ? ` ${Math.round(rule.probability * 100)}%` : ''
  switch (rule.mode) {
    case 'offline':
      return `${host} offline${share}`
    case 'latency':
      return `${host} +${rule.latencyMs} ms${share}`
    case 'status':
      return `${host} HTTP ${rule.status}${share}`
  }
}

interface Ack {
  rules: FaultRule[]
  rejected: FaultControlState['rejected']
  instance: string
}

async function sendRules(rules: FaultRule[]): Promise<Ack> {
  const controller = navigator.serviceWorker?.controller
  if (!controller) throw new Error('no controlling service worker')
  const channel = new MessageChannel()
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the service worker did not acknowledge within 3 s')), 3000)
      channel.port1.onmessage = (event) => {
        clearTimeout(timer)
        const { rules: held, rejected, instance } = event.data as Ack
        resolve({ rules: held, rejected, instance })
      }
      controller.postMessage({ type: 'fault:set', rules }, [channel.port2])
    })
  } finally {
    channel.port1.close()
  }
}

let config: LabConfig | null = null

async function apply(reason: 'set' | 'reapplied') {
  if (!config) return
  const rules = rulesFor(config, state.specs)
  publish({ pending: true, error: null })
  try {
    const ack = await sendRules(rules)
    publish({ applied: ack.rules, appliedBy: ack.instance, rejected: ack.rejected, pending: false })
    const active = ack.rules.length ? ack.rules.map(describeRule).join(', ') : 'none'
    const rejected = ack.rejected.length
      ? `; rejected ${ack.rejected.map((r) => `${r.origin} (${r.reason})`).join(', ')}`
      : ''
    recordEvent(
      'fault',
      reason === 'reapplied' || ack.rejected.length ? 'warn' : 'info',
      reason === 'reapplied' ? 'faults:reapplied' : 'faults:set',
      `${reason === 'reapplied' ? 'worker had lost its rules; ' : ''}active: ${active}${rejected}`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    publish({ pending: false, error: message })
    recordEvent('fault', 'error', 'faults:failed', message)
  }
}

export function configureFaultControl(labConfig: LabConfig) {
  if (config) return
  config = labConfig

  let lastController: ServiceWorker | null = navigator.serviceWorker?.controller ?? null
  // A replacement is noticed at controllerchange, but the new controller's handshake has not finished then, so the lab
  // is briefly unavailable: remember the replacement until the rules can be sent.
  let replaced = false
  subscribeServiceWorker(() => {
    const worker = getServiceWorkerSnapshot()
    const controller = navigator.serviceWorker?.controller ?? null
    if (controller !== lastController) {
      lastController = controller
      replaced = true
    }
    if (!state.applied.length) replaced = false
    if (state.pending || !state.applied.length || !faultLabAvailability(worker).ok) return
    // A replacement controller starts with no rules; so does a restarted worker, which shows up as a batch from a new
    // instance.
    const restarted = worker.reportedWorkerInstance !== null && worker.reportedWorkerInstance !== state.appliedBy
    if (replaced || restarted) {
      replaced = false
      void apply('reapplied')
    }
  })
}

export function setFaultSpec(id: LabTargetId, spec: FaultSpec) {
  publish({ specs: { ...state.specs, [id]: spec } })
  void apply('set')
}

export function resetFaults() {
  publish({ specs: {} })
  void apply('set')
}
