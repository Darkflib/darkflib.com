// The browser side of wwff-recon's API (github.com/Darkflib/wwff-recon, docs/contract.md), served at
// /tools/domain/api/* behind the same forward_auth gate as the page.

import { AuthError } from './auth'

export type Check = 'rdap' | 'dns' | 'tls' | 'headers'
export const CHECKS: { id: Check; name: string; blurb: string }[] = [
  { id: 'rdap', name: 'REGISTRATION', blurb: 'RDAP, or WHOIS where a registry has no RDAP' },
  { id: 'dns', name: 'DNS', blurb: 'delegation trace, records, DNSSEC, CAA' },
  { id: 'tls', name: 'TLS', blurb: 'certificate chain, versions, CT, OCSP' },
  { id: 'headers', name: 'HTTP', blurb: 'response and security headers, redirects' },
]

/** domaincheck's CollectionResult, as JSON. `data` is the collector's own model, rendered loosely. */
export interface CollectionResult {
  collector: Check
  ok: boolean
  duration_ms: number
  data: Record<string, unknown> | null
  error: { kind: string; retryable: boolean; upstream: string | null; message: string } | null
}

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

/** Polls a queued or running run until it finishes. This implementation answers finished runs straight away. */
export async function waitForRun(run: Run, signal: { cancelled: boolean }): Promise<Run> {
  let current = run
  let delay = 1000
  while ((current.status === 'queued' || current.status === 'running') && !signal.cancelled) {
    await new Promise((resolve) => setTimeout(resolve, delay))
    delay = Math.min(delay * 1.5, 5000)
    current = await getRun(current.id)
  }
  return current
}
