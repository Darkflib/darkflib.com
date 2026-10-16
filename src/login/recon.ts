// The browser side of wwff-recon's API (github.com/Darkflib/wwff-recon, docs/contract.md), served at
// /tools/domain/api/* behind the same forward_auth gate as the page.

import { AuthError } from './auth'
import type { Check, CollectionResult } from './reconView'

export type { Check, CollectionResult }
export const CHECKS: { id: Check; name: string; blurb: string }[] = [
  { id: 'rdap', name: 'REGISTRATION', blurb: 'RDAP, or WHOIS where a registry has no RDAP' },
  { id: 'dns', name: 'DNS', blurb: 'delegation, every nameserver compared, DNSSEC, CAA' },
  { id: 'tls', name: 'TLS', blurb: 'certificate chain, versions, CT, OCSP' },
  { id: 'headers', name: 'HTTP', blurb: 'response and security headers, redirects' },
]

export interface Run {
  id: string
  domain: string
  domain_unicode: string
  domain_a_label: string
  checks: Check[]
  status: 'queued' | 'running' | 'complete' | 'failed'
  created_at: string
  completed_at: string | null
  cost: number
  refunded: boolean
  balance_after: number | null
  results?: Partial<Record<Check, CollectionResult>>
}

const API = '/tools/domain/api'

async function call<T>(path: string, init?: { json: unknown }): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: init ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: init ? { 'Content-Type': 'application/json' } : undefined,
    body: init ? JSON.stringify(init.json) : undefined,
  })
  if (!response.ok) {
    let body: { reason?: unknown; step_up?: AuthError['stepUp'] } = {}
    try {
      body = await response.json()
    } catch {
      // A proxy error page, or no service behind the route yet.
    }
    throw new AuthError(
      response.status,
      typeof body.reason === 'string' ? body.reason : null,
      response.status === 401 && body.step_up ? body.step_up : null,
    )
  }
  return (await response.json()) as T
}

/** Starts a run: spends one credit, then collects. Resolves when the service answers, finished or queued. */
export const startRun = (domain: string, checks: Check[]) => call<Run>('/runs', { json: { domain, checks } })

export const getRun = (id: string) => call<Run>(`/runs/${encodeURIComponent(id)}`)

export const listRuns = () => call<{ runs: Run[] }>('/runs')

/** Thrown by waitForRun when a run is still unfinished at the client's deadline: it may yet finish server-side. */
export class RunStillGoing extends Error {
  override name = 'RunStillGoing'
}

/**
 * Polls a queued or running run until it finishes, the caller cancels (checked after every wait and every request,
 * so nothing is fetched or applied after an unmount), or `deadlineMs` passes. This implementation answers finished
 * runs straight away; a queued or multi-PoP one would make this matter.
 */
export async function waitForRun(run: Run, signal: { cancelled: boolean }, deadlineMs = 120_000): Promise<Run> {
  const deadline = Date.now() + deadlineMs
  let current = run
  let delay = 1000
  while (current.status === 'queued' || current.status === 'running') {
    if (Date.now() + delay > deadline) throw new RunStillGoing(current.id)
    await new Promise((resolve) => setTimeout(resolve, delay))
    if (signal.cancelled) return current
    delay = Math.min(delay * 1.5, 5000)
    current = await getRun(current.id)
    if (signal.cancelled) return current
  }
  return current
}
