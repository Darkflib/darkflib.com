// reconView's detail tables (the per-nameserver answers, cipher suites, weaknesses, header checks, lesser findings)
// as labelled rows, the same shape as the summaries, so the comparison and the report treat them like any other row.
// A table added to reconView gets a line here. No DOM, so the unit tests run it headless.

import {
  type Check,
  cipherRows,
  ctIssuers,
  ctNames,
  headerChecks,
  minorFindings,
  nameserverMatrix,
  type Row,
  vulnerabilities,
} from './reconView.ts'

export interface DetailTable {
  title: string
  rows: Row[]
}

const join = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ')

function nameservers(data: Record<string, unknown>): DetailTable | null {
  const matrix = nameserverMatrix(data)
  if (!matrix || matrix.columns.length === 0) return null
  const where = (index: number) => `${matrix.columns[index].nameserver} ${matrix.columns[index].ip}`
  return {
    title: 'Nameservers compared',
    rows: [
      ...matrix.columns.map(
        (column): Row => ({
          label: `${column.nameserver} ${column.ip}`,
          value: column.status,
          tone: column.status === 'ok' ? undefined : column.tone,
        }),
      ),
      ...matrix.rows.map((row): Row => {
        const answered = row.cells.flatMap((cell, index) => (cell ? [{ cell, index }] : []))
        if (!answered.length) return { label: row.label, value: undefined }
        if (!row.differs)
          return { label: row.label, value: `all agree: ${answered[0].cell.values.join(', ') || '(empty)'}` }
        return {
          label: row.label,
          value: answered
            .filter(({ cell }) => cell.differs)
            .map(({ cell, index }) => `${where(index)} says ${cell.values.join(', ') || '(empty)'}`)
            .join('; '),
          tone: 'warn',
          note: `Nameservers disagree on ${row.label}`,
        }
      }),
    ],
  }
}

/** Every detail table reconView has for a check's data, empty ones left out. */
export function detailTables(check: Check, data: Record<string, unknown>): DetailTable[] {
  const tables: (DetailTable | null)[] = []
  if (check === 'dns') tables.push(nameservers(data))
  if (check === 'tls') {
    tables.push({
      title: 'Cipher suites',
      rows: cipherRows(data).map((suite) => ({
        label: `${suite.version} ${suite.name}`,
        value: join(suite.rating, suite.group, suite.issues.length > 0 && suite.issues.join(', ')),
        tone: suite.tone === 'good' ? undefined : suite.tone,
      })),
    })
    tables.push({
      title: 'Weaknesses',
      rows: vulnerabilities(data).map((weakness) => ({
        label: weakness.name,
        value: join(
          weakness.status.replaceAll('_', ' '),
          weakness.status === 'vulnerable' && weakness.severity,
          weakness.detail,
        ),
        tone: weakness.tone,
      })),
    })
  }
  if (check === 'headers') {
    tables.push({
      title: 'Header checks',
      rows: headerChecks(data).map((entry) => ({
        label: entry.name,
        value: join(entry.result, entry.value, entry.detail),
        tone: entry.tone,
      })),
    })
    tables.push({
      title: 'Lesser findings',
      rows: minorFindings(data).map((text) => ({ label: text, value: 'noted', tone: 'info' })),
    })
  }
  if (check === 'ct') {
    tables.push({
      title: 'Issuers',
      rows: ctIssuers(data).map((issuer) => ({
        label: issuer.name,
        value: join(`${issuer.current} current`, `${issuer.total} logged`, issuer.last && `last ${issuer.last}`),
      })),
    })
    // Certificates themselves are left out: renewals would make every comparison a wall of changes.
    tables.push({
      title: 'Names in the logs',
      rows: ctNames(data).map((name) => ({
        label: name.name,
        value: join(name.current ? `${name.current} current` : 'none current', `${name.total} logged`),
      })),
    })
  }
  return tables.filter((table): table is DetailTable => table !== null && table.rows.length > 0)
}
