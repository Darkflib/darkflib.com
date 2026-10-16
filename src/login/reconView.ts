// What /tools/domain/ shows of a run: a summary row per field that matters for each check, the tone of each (so the
// page can mark what deserves a look), and the findings drawn from them. No DOM, so the unit tests run it headless.
// The payloads are domaincheck's models (schema_version 2.x) as JSON, read loosely: a missing field is "—", not an
// error.

export type Check = 'rdap' | 'dns' | 'tls' | 'headers'

/** domaincheck's CollectionResult, as JSON. `data` is the collector's own model, rendered loosely. */
export interface CollectionResult {
  collector: Check
  ok: boolean
  duration_ms: number
  data: Record<string, unknown> | null
  error: { kind: string; retryable: boolean; upstream: string | null; message: string } | null
}

export type Value = string | number | boolean | null | undefined

/** `good` and `info` only colour the row; `warn` and `bad` also become findings above the panels. */
export type Tone = 'good' | 'info' | 'warn' | 'bad'

export interface Row {
  label: string
  value: Value
  tone?: Tone
  /** Said in the findings when the tone is warn or bad, and as the row's tooltip. */
  note?: string
  /** Left out when there's nothing to show, rather than shown as "—". */
  optional?: boolean
}

export interface Finding {
  check: Check
  tone: 'warn' | 'bad'
  text: string
}

const DAY = 86_400_000

/** Reads a dotted path out of a collector's loosely typed payload. */
export function at(data: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object' && key in node) return (node as Record<string, unknown>)[key]
    return undefined
  }, data)
}

const list = (value: unknown, pick?: (item: Record<string, unknown>) => Value): Value[] =>
  Array.isArray(value)
    ? value.map((item) => (pick ? pick(item as Record<string, unknown>) : (item as Value))).filter(Boolean)
    : []

const str = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined)

const time = (value: unknown) => {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isNaN(parsed) ? undefined : parsed
}

/** ISO date, unambiguous whatever the reader's locale. */
export const isoDate = (ms: number | undefined) =>
  ms === undefined ? undefined : new Date(ms).toISOString().slice(0, 10)

const daysUntil = (ms: number | undefined, now: number) => (ms === undefined ? undefined : Math.floor((ms - now) / DAY))

/** "2027-02-28 (in 135 days)", or "(4 days ago)" once it's past. */
function dated(ms: number | undefined, now: number) {
  const days = daysUntil(ms, now)
  if (ms === undefined || days === undefined) return undefined
  return `${isoDate(ms)} (${days >= 0 ? `in ${days} day${days === 1 ? '' : 's'}` : `${-days} day${days === -1 ? '' : 's'} ago`})`
}

/** RDAP's event for an action (registration, expiration), else the WHOIS fallback's field. */
function event(data: Record<string, unknown>, action: string, whois: string) {
  const found = list(at(data, 'events'), (entry) => (entry.action === action ? (entry.date as string) : null))[0]
  return time(found) ?? time(at(data, `whois43.${whois}`))
}

/**
 * Turns whatever the user typed or pasted into the name the service expects: a URL keeps only its host, and a
 * port, path, user, or trailing dot goes. The service still validates it (IP literals, single labels).
 */
export function normaliseDomain(input: string): string {
  let text = input.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      text = new URL(text).hostname
    } catch {
      // Not a URL after all; the service will say what's wrong with it.
    }
  }
  text = text.replace(/^[^@/]*@/, '').replace(/[/?#].*$/, '')
  // A port, but not the colons of an IPv6 literal (which the service refuses in words).
  if (/^[^:]+:\d+$/.test(text)) text = text.replace(/:\d+$/, '')
  return text.replace(/\.$/, '').toLowerCase()
}

/** domaincheck's NameserverProbe (schema 2.1+, `nameserver_comparison.servers`): one nameserver address, asked directly. */
interface Probe {
  nameserver: string
  ip: string
  family: number
  status: string
  error: string | null
  rcode: string | null
  authoritative: boolean
  soa: {
    serial: number
    mname: string
    rname: string
    refresh: number
    retry: number
    expire: number
    minimum: number
  } | null
  answers: Record<string, { values?: string[]; rcode?: string | null; error?: string | null }>
}

const probes = (comparison: unknown) => list(at(comparison, 'servers')) as unknown as Probe[]

/** Whether a probe's answers count toward what the nameservers agree on (domaincheck's own rule). */
const counts = (probe: Probe) =>
  probe.status === 'answered' && probe.authoritative && (probe.rcode === 'NOERROR' || probe.rcode === 'NXDOMAIN')

/** This checker has no route there (IPv6 from an IPv4-only host): nothing was sent, so it says nothing about the server. */
const noRoute = (probe: Probe) => probe.status === 'unreachable' && probe.error === 'NoRoute'

const where = (probe: Probe) => `${probe.nameserver} ${probe.ip}`

/** What went wrong with a nameserver address, in words, or undefined when its answers count. */
function trouble(probe: Probe): string | undefined {
  if (counts(probe) || noRoute(probe)) return undefined
  if (probe.status === 'timeout') return 'no answer (timeout)'
  if (probe.status !== 'answered') return `no answer (${probe.status}${probe.error ? `: ${probe.error}` : ''})`
  if (probe.rcode !== 'NOERROR' && probe.rcode !== 'NXDOMAIN') return `answered ${probe.rcode}`
  return 'answered, but not authoritatively'
}

/** The summary rows drawn from `nameserver_comparison`: serial drift, unanswering servers, NS sets, record drift. */
function comparisonRows(comparison: Record<string, unknown>): Row[] {
  const servers = probes(comparison)
  const serials = list(comparison.serials).map(Number)
  const troubled = servers.flatMap((probe) => {
    const why = trouble(probe)
    return why ? [`${where(probe)}: ${why}`] : []
  })
  const asked = servers.filter((probe) => !noRoute(probe))
  const unrouted = servers.length - asked.length
  const parentOnly = list(comparison.parent_only).map(String)
  const zoneOnly = list(comparison.zone_only).map(String)
  const disagreements = list(comparison.disagreements) as unknown as {
    record_type: string
    differing: { nameserver: string; ip: string; missing: string[]; extra: string[] }[]
  }[]
  const drift = disagreements.map((entry) => {
    const first = entry.differing[0]
    const how = first
      ? [
          first.missing.length && `lacks ${first.missing.join(', ')}`,
          first.extra.length && `adds ${first.extra.join(', ')}`,
        ]
          .filter(Boolean)
          .join(' and ')
      : ''
    const more = entry.differing.length > 1 ? ` (and ${entry.differing.length - 1} more)` : ''
    const label = entry.record_type === 'SOA' ? 'SOA (primary, contact or timers)' : entry.record_type
    return first ? `${label}: ${first.nameserver} ${first.ip} ${how || 'differs'}${more}` : label
  })
  return [
    serials.length > 1
      ? {
          label: 'Serial',
          value: serials.join(' ≠ '),
          tone: 'warn',
          note: `The nameservers serve different SOA serials (${serials.join(', ')}): one has not caught up`,
        }
      : { label: 'Serial', value: serials[0] },
    {
      label: 'Nameservers answering',
      value: servers.length
        ? `${asked.length - troubled.length} of ${asked.length} address${asked.length === 1 ? '' : 'es'}`
        : undefined,
      ...(troubled.length
        ? { tone: 'bad', note: `Nameservers not answering for the zone: ${troubled.join('; ')}` }
        : asked.length > 0 && { tone: 'good' }),
    },
    {
      label: 'IPv6 not checked',
      value: unrouted ? `${unrouted} address${unrouted === 1 ? '' : 'es'} (no IPv6 route from the checker)` : undefined,
      tone: 'info',
      optional: true,
    },
    {
      label: 'NS sets',
      value: parentOnly.length || zoneOnly.length ? 'parent and zone differ' : undefined,
      tone: 'warn',
      note: `The delegation and the zone list different nameservers: ${[
        parentOnly.length && `only the parent lists ${parentOnly.join(', ')}`,
        zoneOnly.length && `only the zone lists ${zoneOnly.join(', ')}`,
      ]
        .filter(Boolean)
        .join('; ')}`,
      optional: true,
    },
    {
      label: 'Record drift',
      value: disagreements.map((entry) => entry.record_type).join(', '),
      tone: 'warn',
      note: `The nameservers give different answers. ${drift.join('; ')}`,
      optional: true,
    },
  ]
}

export interface MatrixColumn {
  nameserver: string
  ip: string
  family: number
  /** "ok", or what went wrong ("no answer (timeout)", "no IPv6 route"). */
  status: string
  tone: Tone
  /** Whether its answers count toward the consensus (authoritative, NOERROR or NXDOMAIN). */
  counted: boolean
}

export interface MatrixCell {
  values: string[]
  /** Counted, and not what most counted nameservers said. */
  differs: boolean
  /** When it differs: its values the consensus lacks, and the consensus's values it lacks. */
  extra: string[]
  missing: string[]
}

export interface MatrixRow {
  label: string
  /** One per column; null where that address gave no answer for it. */
  cells: (MatrixCell | null)[]
  differs: boolean
}

const MATRIX_ROWS: [string, (probe: Probe) => string[] | null][] = [
  ['Serial', (probe) => (probe.soa ? [String(probe.soa.serial)] : null)],
  ['Primary', (probe) => (probe.soa ? [probe.soa.mname] : null)],
  ['Contact', (probe) => (probe.soa ? [probe.soa.rname] : null)],
  [
    'Timers',
    (probe) =>
      probe.soa
        ? [
            `refresh ${probe.soa.refresh} · retry ${probe.soa.retry} · expire ${probe.soa.expire} · min ${probe.soa.minimum}`,
          ]
        : null,
  ],
  ...['NS', 'A', 'AAAA', 'MX', 'TXT', 'CAA'].map((type): [string, (probe: Probe) => string[] | null] => [
    type,
    (probe) => {
      const answer = probe.answers?.[type]
      if (!answer || answer.error) return null
      return answer.rcode === 'NXDOMAIN' ? ['NXDOMAIN'] : (answer.values ?? [])
    },
  ]),
]

/**
 * `nameserver_comparison` as a table: a column per nameserver address, a row per compared field, and each cell marked
 * where a counted nameserver says something other than what most of them say (the first seen wins a tie, as in
 * domaincheck). Null when the run predates the comparison (domaincheck < v0.4) or found no nameservers.
 */
export function nameserverMatrix(
  data: Record<string, unknown>,
): { columns: MatrixColumn[]; rows: MatrixRow[]; unrouted: string[] } | null {
  const every = probes(at(data, 'nameserver_comparison'))
  // Addresses this checker can't reach at all (no IPv6 route) say nothing about the zone: a note, not a column.
  const servers = every.filter((probe) => !noRoute(probe))
  const unrouted = every.filter(noRoute).map(where)
  if (every.length === 0) return null
  const columns = servers.map((probe): MatrixColumn => {
    const why = trouble(probe)
    return {
      nameserver: probe.nameserver,
      ip: probe.ip,
      family: probe.family,
      status: why ?? 'ok',
      tone: why ? 'bad' : 'good',
      counted: counts(probe),
    }
  })
  const rows = MATRIX_ROWS.map(([label, read]): MatrixRow => {
    const values = servers.map((probe) => (probe.status === 'answered' ? read(probe) : null))
    const key = (cell: string[]) => cell.join('\n')
    const tally = new Map<string, number>()
    let consensus: string[] | undefined
    values.forEach((cell, index) => {
      if (!cell || !columns[index].counted) return
      tally.set(key(cell), (tally.get(key(cell)) ?? 0) + 1)
      if (!consensus || (tally.get(key(cell)) ?? 0) > (tally.get(key(consensus)) ?? 0)) consensus = cell
    })
    const cells = values.map((cell, index): MatrixCell | null => {
      if (cell === null) return null
      const differs =
        columns[index].counted && tally.size > 1 && consensus !== undefined && key(cell) !== key(consensus)
      return {
        values: cell,
        differs,
        extra: differs ? cell.filter((value) => !consensus?.includes(value)) : [],
        missing: differs ? (consensus ?? []).filter((value) => !cell.includes(value)) : [],
      }
    })
    return { label, cells, differs: cells.some((cell) => cell?.differs) }
  })
  return { columns, rows, unrouted }
}

/** The few fields worth reading first for each check; the full result is under it. */
export function summary(check: Check, data: Record<string, unknown>, now = Date.now()): Row[] {
  switch (check) {
    case 'rdap': {
      const registrar =
        str(at(data, 'whois43.registrar')) ??
        (list(at(data, 'entities'), (entity) =>
          Array.isArray(entity.roles) && entity.roles.includes('registrar') ? str(at(entity, 'vcard.fn')) : null,
        )[0] as string | undefined)
      const registered = event(data, 'registration', 'registered_on')
      const expires = event(data, 'expiration', 'expires_on')
      const left = daysUntil(expires, now)
      const age = typeof at(data, 'age_days') === 'number' ? (at(data, 'age_days') as number) : undefined
      const status = list(at(data, 'status')).length ? list(at(data, 'status')) : list(at(data, 'whois43.status'))
      const troubled = status.filter((entry) => /redemption|pending ?delete|hold/i.test(String(entry)))
      const nameservers = list(at(data, 'nameservers'), (ns) => str(ns.ldh_name)?.toLowerCase())
      return [
        { label: 'Source', value: at(data, 'data_source') === 'whois' ? 'WHOIS (no RDAP)' : 'RDAP' },
        { label: 'Registrar', value: registrar },
        {
          label: 'Registered',
          value: isoDate(registered),
          ...(age !== undefined && age < 30 && { tone: 'warn', note: `Registered ${age} days ago` }),
        },
        {
          label: 'Expires',
          value: dated(expires, now),
          ...(left !== undefined &&
            (left < 0
              ? { tone: 'bad', note: 'The registration has expired' }
              : left < 30
                ? { tone: 'bad', note: `The registration expires in ${left} days` }
                : left < 90 && { tone: 'warn', note: `The registration expires in ${left} days` })),
        },
        {
          label: 'Status',
          value: status.join(', '),
          ...(troubled.length && { tone: 'bad', note: `Registry status: ${troubled.join(', ')}` }),
        },
        { label: 'Nameservers', value: nameservers.join(', ') },
        {
          label: 'DNSSEC (registry)',
          value: at(data, 'secure_dns.delegation_signed') === true ? 'delegation signed' : undefined,
          tone: 'good',
          optional: true,
        },
      ]
    }
    case 'dns': {
      const nxdomain = at(data, 'nxdomain') === true
      const a = list(at(data, 'forward.a'))
      const aaaa = list(at(data, 'forward.aaaa'))
      const ns = list(at(data, 'forward.ns')).map((name) => String(name).replace(/\.$/, '').toLowerCase())
      const dnssec = at(data, 'dnssec') as Record<string, unknown> | null | undefined
      const lame = list(at(data, 'lame_delegation'))
      const glue = list(at(data, 'glue_mismatches'))
      const caa = list(at(data, 'caa_tree'), (node) => (list(node.records).length ? (node.zone as string) : null))
      const skips = list(at(data, 'policy_skips'), (skip) =>
        `${skip.nameserver_name ?? ''} ${skip.nameserver_ip ?? ''}`.trim(),
      )
      const comparison = at(data, 'nameserver_comparison') as Record<string, unknown> | null | undefined
      return [
        nxdomain
          ? { label: 'Exists', value: 'no (NXDOMAIN)', tone: 'bad', note: 'The name does not exist in DNS' }
          : { label: 'Exists', value: true },
        { label: 'Nameservers', value: ns.join(', ') || list(at(data, 'authoritative_nameservers')).join(', ') },
        { label: 'A', value: a.join(', ') },
        {
          label: 'AAAA',
          value: aaaa.join(', '),
          ...(!nxdomain && a.length > 0 && aaaa.length === 0 && { tone: 'info', note: 'IPv4 only' }),
        },
        {
          label: 'MX',
          value: list(at(data, 'forward.mx'), (mx) =>
            `${mx.preference ?? mx.priority ?? ''} ${String(mx.exchange ?? '').replace(/\.$/, '')}`.trim(),
          ).join(', '),
        },
        {
          label: 'TXT kinds',
          value: [...new Set(list(at(data, 'forward.txt_typed'), (txt) => txt.kind as string))].join(', '),
        },
        dnssec?.validated
          ? { label: 'DNSSEC', value: 'validated', tone: 'good' }
          : list(dnssec?.ds_records).length
            ? {
                label: 'DNSSEC',
                value: `fails: ${dnssec?.failure_reason ?? 'not validated'}`,
                tone: 'bad',
                note: `DNSSEC is present but does not validate (${dnssec?.failure_reason ?? 'no reason given'})`,
              }
            : { label: 'DNSSEC', value: 'not signed', tone: 'info' },
        {
          label: 'CAA',
          value: caa.length ? caa.join(', ') : 'none (any CA may issue)',
          tone: caa.length ? 'good' : 'info',
        },
        {
          label: 'Wildcard',
          value: at(data, 'wildcard.detected') === true ? 'yes' : undefined,
          tone: 'warn',
          note: 'Every subdomain resolves (wildcard record)',
          optional: true,
        },
        ...(comparison ? comparisonRows(comparison) : []),
        // Read from the comparison's probes when there is one (domaincheck v0.4), which say it per address.
        {
          label: 'Lame delegations',
          value: comparison ? undefined : lame.length || undefined,
          tone: 'bad',
          note: `${lame.length} nameserver${lame.length === 1 ? '' : 's'} named in the delegation did not answer for the zone`,
          optional: true,
        },
        {
          label: 'Glue mismatches',
          value: glue.length || undefined,
          tone: 'warn',
          note: 'Glue at the parent disagrees with the zone',
          optional: true,
        },
        // Nameservers the delegation named at internal addresses, which wwff-recon refused to query (domaincheck v0.3).
        {
          label: 'Not queried (internal)',
          value: skips.join(', '),
          tone: 'warn',
          note: `Nameservers at internal addresses were not queried: ${skips.join(', ')}`,
          optional: true,
        },
      ]
    }
    case 'tls': {
      const expires = time(at(data, 'leaf_certificate.not_after'))
      const left = daysUntil(expires, now)
      const versions = list(at(data, 'accepted_versions')).map(String)
      const legacy = versions.filter((version) => /SSL|TLSv1(\.[01])?$/.test(version))
      const names = list(at(data, 'leaf_certificate.san_dns'))
      const verified = at(data, 'chain_validation.verified')
      return [
        { label: 'Protocol', value: str(at(data, 'connection.protocol')) },
        { label: 'Cipher', value: str(at(data, 'connection.cipher_name')) },
        {
          label: 'Versions',
          value: versions.join(', '),
          ...(legacy.length && { tone: 'warn', note: `Accepts legacy ${legacy.join(', ')}` }),
        },
        { label: 'Subject', value: str(at(data, 'leaf_certificate.subject.common_name')) },
        {
          label: 'Names',
          value: names.length > 4 ? `${names.slice(0, 4).join(', ')} +${names.length - 4}` : names.join(', '),
        },
        {
          label: 'Issuer',
          value: str(at(data, 'leaf_certificate.issuer.common_name')),
          ...(at(data, 'leaf_certificate.is_self_signed') === true && {
            tone: 'bad',
            note: 'The certificate is self-signed',
          }),
        },
        {
          label: 'Expires',
          value: dated(expires, now),
          ...(left !== undefined &&
            (left < 0
              ? { tone: 'bad', note: 'The certificate has expired' }
              : left < 14
                ? { tone: 'bad', note: `The certificate expires in ${left} days` }
                : left < 30 && { tone: 'warn', note: `The certificate expires in ${left} days` })),
        },
        {
          label: 'Chain',
          value:
            verified === true
              ? 'verified'
              : verified === false
                ? `not verified: ${at(data, 'chain_validation.reason') ?? '?'}`
                : undefined,
          tone: verified === true ? 'good' : 'bad',
          note: `The chain does not verify (${at(data, 'chain_validation.reason') ?? 'no reason given'})`,
          optional: true,
        },
        { label: 'OCSP stapled', value: at(data, 'ocsp_stapled') as boolean },
        {
          label: 'SCTs',
          value: at(data, 'sct_summary')
            ? `${at(data, 'sct_summary.total')} (${at(data, 'sct_summary.known_logs')} from known logs)`
            : undefined,
        },
      ]
    }
    case 'headers': {
      const security = (at(data, 'security') ?? {}) as Record<string, unknown>
      const present = Object.entries(security)
        .filter(([, value]) => value != null)
        .map(([name]) => name.replaceAll('_', '-'))
      const status = at(data, 'status_code') as number | undefined
      const redirects = list(at(data, 'redirect_chain'))
      const upgrade = at(data, 'http_upgrade.redirects_to_https')
      const hsts = security.hsts as Record<string, unknown> | null | undefined
      return [
        {
          label: 'Status',
          value: status,
          ...(typeof status === 'number' && status >= 400 && { tone: 'warn', note: `The site answers HTTP ${status}` }),
        },
        { label: 'HTTP', value: str(at(data, 'http_version')) },
        { label: 'Server', value: str(at(data, 'server')) },
        {
          label: 'Final URL',
          value: str(at(data, 'final_url')) !== str(at(data, 'url')) ? str(at(data, 'final_url')) : undefined,
          optional: true,
        },
        { label: 'Redirects', value: redirects.length },
        {
          label: 'Port 80 → HTTPS',
          value: upgrade as boolean,
          ...(upgrade === false && { tone: 'warn', note: 'Plain HTTP does not redirect to HTTPS' }),
        },
        hsts
          ? {
              label: 'HSTS',
              value: [
                `max-age ${hsts.max_age}`,
                hsts.include_subdomains && 'subdomains',
                at(data, 'hsts_preload') ? 'preloaded' : hsts.preload ? 'preload asked' : null,
              ]
                .filter(Boolean)
                .join(', '),
              tone: 'good',
            }
          : { label: 'HSTS', value: 'none', tone: 'warn', note: 'No Strict-Transport-Security header' },
        {
          label: 'Security headers',
          value: present.join(', ') || 'none',
          ...(!security.csp && { tone: 'info', note: 'No Content-Security-Policy' }),
        },
        { label: 'Cookies', value: list(at(data, 'cookies')).length },
      ]
    }
  }
}

/** The rows the page shows: optional rows only when they have something to say. */
export const visibleRows = (rows: Row[]) =>
  rows.filter((row) => !row.optional || (row.value !== undefined && row.value !== null && row.value !== ''))

export const show = (value: Value) =>
  value === undefined || value === null || value === ''
    ? '—'
    : typeof value === 'boolean'
      ? value
        ? 'yes'
        : 'no'
      : String(value)

/** What deserves a look across a run's checks, worst first: each warn or bad row, and each check that failed. */
export function findings(
  checks: Check[],
  results: Partial<Record<Check, CollectionResult>> | undefined,
  now = Date.now(),
): Finding[] {
  const found: Finding[] = []
  for (const check of checks) {
    const result = results?.[check]
    if (!result) continue
    if (!result.ok || !result.data) {
      found.push({ check, tone: 'warn', text: `Check failed: ${result.error?.message ?? 'no data'}` })
      continue
    }
    for (const row of visibleRows(summary(check, result.data, now))) {
      if (row.tone === 'warn' || row.tone === 'bad') found.push({ check, tone: row.tone, text: row.note ?? row.label })
    }
  }
  return found.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1))
}
