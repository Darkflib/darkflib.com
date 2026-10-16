// Two runs side by side: the same domain at different times, or two domains. Built only from reconView's summary rows,
// its detail tables (through reconDetail), and its findings, so a row another check adds there shows up here without a
// change. No DOM, so the unit tests run it
// headless.

import { detailTables } from './reconDetail.ts'
import type { Run } from './reconRun.ts'
import {
  type Check,
  type Finding,
  findings,
  type Row,
  summary,
  type Tone,
  type Value,
  visibleRows,
} from './reconView.ts'

export interface RowDiff {
  label: string
  before: Value
  after: Value
  beforeTone?: Tone
  afterTone?: Tone
  changed: boolean
}

export interface CheckDiff {
  check: Check
  /** Whether each side ran the check, and with what outcome: `ok`, or the error kind. */
  before: string | null
  after: string | null
  rows: RowDiff[]
  /** reconDetail's tables (cipher suites, nameservers compared, …), row by row the same way. */
  tables: { title: string; rows: RowDiff[] }[]
}

export interface FindingsDiff {
  appeared: Finding[]
  cleared: Finding[]
  kept: Finding[]
}

export interface RunDiff {
  checks: CheckDiff[]
  findings: FindingsDiff
  changedRows: number
}

const empty = (value: Value) => value === undefined || value === null || value === ''

const same = (a: Value, b: Value) => (empty(a) && empty(b)) || a === b

const outcome = (run: Run, check: Check) => {
  const result = run.results?.[check]
  if (!run.checks.includes(check) || !result) return null
  return result.ok && result.data ? 'ok' : (result.error?.kind ?? 'failed')
}

const dataOf = (run: Run, check: Check) => {
  const result = run.results?.[check]
  return result?.ok && result.data ? result.data : null
}

const rowsOf = (run: Run, check: Check, now: number) => {
  const data = dataOf(run, check)
  return data ? visibleRows(summary(check, data, now)) : []
}

const tablesOf = (run: Run, check: Check) => {
  const data = dataOf(run, check)
  return data ? detailTables(check, data) : []
}

/** Lines two lists of rows up by label, the earlier run's order first. `comparable` is false when only one side has
 * data: every row differs then, which the outcome already says. */
function diffRows(left: Row[], right: Row[], comparable: boolean): RowDiff[] {
  const labels = [...new Set([...left.map((row) => row.label), ...right.map((row) => row.label)])]
  return labels.map((label): RowDiff => {
    const l = left.find((row) => row.label === label)
    const r = right.find((row) => row.label === label)
    return {
      label,
      before: l?.value,
      after: r?.value,
      beforeTone: l?.tone,
      afterTone: r?.tone,
      changed: comparable && !same(l?.value, r?.value),
    }
  })
}

const key = (finding: Finding) => `${finding.check}\u0000${finding.text}`

/**
 * Row by row, check by check. Both sides are read with the same `now`, so an expiry date that didn't move doesn't
 * show as changed just because the runs were taken on different days. Rows keep reconView's order, with any row only
 * the later run has after the earlier run's.
 */
export function compareRuns(before: Run, after: Run, now = Date.now()): RunDiff {
  const order: Check[] = ['rdap', 'dns', 'tls', 'headers']
  const checks: CheckDiff[] = []
  let changedRows = 0
  for (const check of order) {
    const a = outcome(before, check)
    const b = outcome(after, check)
    if (a === null && b === null) continue
    const rows = diffRows(rowsOf(before, check, now), rowsOf(after, check, now), a === b)
    const left = tablesOf(before, check)
    const right = tablesOf(after, check)
    const titles = [...new Set([...left.map((table) => table.title), ...right.map((table) => table.title)])]
    const tables = titles.map((title) => ({
      title,
      rows: diffRows(
        left.find((table) => table.title === title)?.rows ?? [],
        right.find((table) => table.title === title)?.rows ?? [],
        a === b,
      ),
    }))
    changedRows += [...rows, ...tables.flatMap((table) => table.rows)].filter((row) => row.changed).length
    checks.push({ check, before: a, after: b, rows, tables })
  }
  const was = findings(before.checks, before.results, now)
  const is = findings(after.checks, after.results, now)
  const wasKeys = new Set(was.map(key))
  const isKeys = new Set(is.map(key))
  return {
    checks,
    changedRows,
    findings: {
      appeared: is.filter((finding) => !wasKeys.has(key(finding))),
      cleared: was.filter((finding) => !isKeys.has(key(finding))),
      kept: is.filter((finding) => wasKeys.has(key(finding))),
    },
  }
}

export interface JsonChange {
  /** `rdap.data.status[]` for a list of plain values (compared as a set), `tls.data.chain[1].issuer` otherwise. */
  path: string
  kind: 'added' | 'removed' | 'changed'
  before?: unknown
  after?: unknown
}

const plain = (value: unknown) => value === null || typeof value !== 'object'

/** Keys left out of the raw diff: they change on every run and say nothing about the domain. */
export const NOISE = new Set(['duration_ms'])

/**
 * The raw difference between two runs' results. Lists of plain values (addresses, statuses, names) are compared as
 * sets, so a resolver rotating its A records reads as no change; lists of objects (the delegation trace, the chain)
 * are compared position by position.
 */
export function jsonDiff(before: unknown, after: unknown, path = '', out: JsonChange[] = []): JsonChange[] {
  if (Array.isArray(before) && Array.isArray(after) && before.every(plain) && after.every(plain)) {
    const count = (list: unknown[]) => {
      const counts = new Map<string, number>()
      for (const item of list) counts.set(JSON.stringify(item), (counts.get(JSON.stringify(item)) ?? 0) + 1)
      return counts
    }
    const a = count(before)
    const b = count(after)
    for (const [item, n] of a) {
      for (let i = b.get(item) ?? 0; i < n; i++)
        out.push({ path: `${path}[]`, kind: 'removed', before: JSON.parse(item) })
    }
    for (const [item, n] of b) {
      for (let i = a.get(item) ?? 0; i < n; i++) out.push({ path: `${path}[]`, kind: 'added', after: JSON.parse(item) })
    }
    return out
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      const at = `${path}[${i}]`
      if (i >= after.length) out.push({ path: at, kind: 'removed', before: before[i] })
      else if (i >= before.length) out.push({ path: at, kind: 'added', after: after[i] })
      else jsonDiff(before[i], after[i], at, out)
    }
    return out
  }
  if (
    before &&
    after &&
    typeof before === 'object' &&
    typeof after === 'object' &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const a = before as Record<string, unknown>
    const b = after as Record<string, unknown>
    for (const name of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
      if (NOISE.has(name)) continue
      const at = path ? `${path}.${name}` : name
      if (!(name in b)) out.push({ path: at, kind: 'removed', before: a[name] })
      else if (!(name in a)) out.push({ path: at, kind: 'added', after: b[name] })
      else jsonDiff(a[name], b[name], at, out)
    }
    return out
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ path, kind: 'changed', before, after })
  return out
}

/** A run's label in a picker or a heading: `example.com · 2026-10-16 09:00 UTC`. */
export const runLabel = (run: Pick<Run, 'domain_unicode' | 'created_at'>) =>
  `${run.domain_unicode} · ${run.created_at.slice(0, 16).replace('T', ' ')} UTC`
