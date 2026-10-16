// A run as wwff-recon answers it (github.com/Darkflib/wwff-recon, docs/contract.md "A run"). On its own, without
// recon.ts's fetch code, so the comparison and report modules (and their unit tests) can use it headless.

import type { Check, CollectionResult } from './reconView.ts'

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
