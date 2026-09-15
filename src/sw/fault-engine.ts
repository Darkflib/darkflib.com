// Fault Lab engine: per-tab rules, matching, and the faulted responses. Worker-only (see tsconfig.sw.json).
import { type FaultRule, isFaultRule, MAX_FAULT_RULES } from './protocol'

/** Rules per tab (client id). Map order is insertion order, so the oldest tab is evicted first past the bound. */
const rulesByClient = new Map<string, FaultRule[]>()
const MAX_FAULT_CLIENTS = 32

export interface RuleUpdate {
  rules: FaultRule[]
  rejected: { origin: string; reason: string }[]
}

/**
 * Replace a tab's rules. Invalid rules, rules for the site's own origin (the lab must never be able to break the page
 * that controls it), and duplicate origins are rejected individually, with a reason the page can show.
 */
export function setRules(clientId: string, candidates: unknown[], siteOrigin: string): RuleUpdate {
  const rules: FaultRule[] = []
  const rejected: RuleUpdate['rejected'] = []
  for (const candidate of candidates.slice(0, MAX_FAULT_RULES)) {
    const origin =
      typeof (candidate as { origin?: unknown })?.origin === 'string' ? (candidate as FaultRule).origin : '?'
    if (!isFaultRule(candidate)) rejected.push({ origin, reason: 'invalid rule' })
    else if (candidate.origin === siteOrigin)
      rejected.push({ origin, reason: "the site's own origin is never faulted" })
    else if (rules.some((rule) => rule.origin === candidate.origin))
      rejected.push({ origin, reason: 'duplicate origin' })
    else rules.push({ ...candidate })
  }

  rulesByClient.delete(clientId)
  if (rules.length) rulesByClient.set(clientId, rules)
  while (rulesByClient.size > MAX_FAULT_CLIENTS) {
    const oldest = rulesByClient.keys().next().value
    if (oldest === undefined) break
    rulesByClient.delete(oldest)
  }
  return { rules, rejected }
}

/** Drop rules for tabs that no longer exist. */
export function pruneRules(liveClientIds: ReadonlySet<string>) {
  for (const clientId of rulesByClient.keys()) {
    if (!liveClientIds.has(clientId)) rulesByClient.delete(clientId)
  }
}

/** The rule to apply to this request, if any. Navigations are never faulted. */
export function ruleFor(clientId: string, request: Request): FaultRule | undefined {
  if (!clientId || request.mode === 'navigate') return undefined
  const rules = rulesByClient.get(clientId)
  if (!rules) return undefined
  const origin = new URL(request.url).origin
  const rule = rules.find((candidate) => candidate.origin === origin)
  return rule && Math.random() < rule.probability ? rule : undefined
}

export function describeFault(rule: FaultRule): string {
  switch (rule.mode) {
    case 'offline':
      return 'simulated network failure; no request sent'
    case 'latency':
      return `simulated latency ${rule.latencyMs} ms, then the real request`
    case 'status':
      return `simulated HTTP ${rule.status}${rule.retryAfterSeconds === undefined ? '' : `, Retry-After ${rule.retryAfterSeconds}`}; no request sent`
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

/** The response the worker gives a faulted request. The page's client must treat it exactly like a real failure. */
export async function faultedResponse(request: Request, rule: FaultRule): Promise<Response> {
  switch (rule.mode) {
    case 'offline':
      // Surfaces to the page as a network error (fetch rejects with TypeError), indistinguishable from a dead origin.
      return Response.error()
    case 'latency':
      // Chromium, Firefox, and WebKit do not currently propagate the page's abort to this request's signal (measured:
      // after a client timeout the delayed request still reaches the origin). That matches a genuinely slow origin,
      // which also receives requests the client has given up on. The signal is still honoured where it does fire.
      await delay(rule.latencyMs ?? 0, request.signal)
      return fetch(request)
    case 'status': {
      const headers = new Headers({ 'Content-Type': 'application/json', 'X-Simulated-Fault': 'status' })
      if (rule.retryAfterSeconds !== undefined) headers.set('Retry-After', String(rule.retryAfterSeconds))
      const body = JSON.stringify({
        error: 'Simulated fault injected by this tab’s service worker',
        status: rule.status,
      })
      return new Response(body, { status: rule.status, headers })
    }
  }
}
