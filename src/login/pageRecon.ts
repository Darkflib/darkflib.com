// The browser side of wwff-pagerecon's API (github.com/Darkflib/wwff-pagerecon, docs/contract.md), served at
// /tools/page/api/* behind the same forward_auth gate as the page.

import { AuthError } from './auth'
import type { PageResult } from './pageView'

export interface PageRun {
  id: string
  url: string
  host: string
  full_page: boolean
  status: 'queued' | 'running' | 'complete' | 'failed'
  created_at: string
  completed_at: string | null
  cost: number
  refunded: boolean
  balance_after: number | null
  result?: PageResult
}

export const API = '/tools/page/api'

async function call<T>(path: string, init?: { json: unknown }): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: init ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: init ? { 'Content-Type': 'application/json' } : undefined,
    body: init ? JSON.stringify(init.json) : undefined,
  })
  if (!response.ok) {
    let body: { reason?: unknown; step_up?: AuthError['stepUp']; detail?: unknown; retry_after?: unknown } = {}
    try {
      body = await response.json()
    } catch {
      // A proxy error page, or no service behind the route yet.
    }
    const error = new AuthError(
      response.status,
      typeof body.reason === 'string' ? body.reason : null,
      response.status === 401 && body.step_up ? body.step_up : null,
    )
    if (typeof body.detail === 'string') error.message = body.detail
    throw error
  }
  return (await response.json()) as T
}

/** Starts a run: spends one credit, then loads the page. Resolves when the service answers, finished or queued. */
export const startRun = (url: string, fullPage: boolean) =>
  call<PageRun>('/runs', { json: { url, full_page: fullPage } })

export const getRun = (id: string) => call<PageRun>(`/runs/${encodeURIComponent(id)}`)

export const listRuns = () => call<{ runs: PageRun[] }>('/runs')

/** Thrown by waitForRun when a run is still unfinished at the client's deadline: it may yet finish server-side. */
export class RunStillGoing extends Error {
  override name = 'RunStillGoing'
}

/**
 * Polls a queued or running run until it finishes, the caller cancels (checked after every wait and every request),
 * or `deadlineMs` passes. This implementation answers finished runs straight away; a queued one would make this
 * matter.
 */
export async function waitForRun(
  run: PageRun,
  signal: { readonly cancelled: boolean },
  deadlineMs = 120_000,
): Promise<PageRun> {
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
