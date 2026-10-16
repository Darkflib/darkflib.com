// What /tools/domain/ shows of a run: a summary row per field that matters for each check, the tone of each (so the
// page can mark what deserves a look), and the findings drawn from them. No DOM, so the unit tests run it headless.
// The payloads are domaincheck's models (schema_version 2.x) as JSON, read loosely: a missing field is "—", not an
// error.

export type Check = 'rdap' | 'dns' | 'tls' | 'headers' | 'ct'

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
  /** domaincheck's own assessment (schema 2.2+) already reports this, so when one is present the row only colours
   * the panel and the finding comes from the assessment, said once. */
  assessed?: boolean
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
  answers: Record<string, { values?: string[]; rcode?: string | null; authoritative?: boolean; error?: string | null }>
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
  // Zones served by more than one provider (each its own primary) differ in serial and SOA by design.
  const primaries = [...new Set(servers.filter(counts).flatMap((probe) => (probe.soa ? [probe.soa.mname] : [])))]
  const multi = primaries.length > 1
  const drifting = disagreements.filter((entry) => !(multi && entry.record_type === 'SOA'))
  const drift = drifting.map((entry) => {
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
    multi
      ? {
          label: 'Serial',
          value: serials.join(', '),
          tone: 'info',
          note: `${primaries.length} primaries (${primaries.join(', ')}): more than one provider, so serials and SOA fields aren't comparable`,
        }
      : serials.length > 1
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
      value: drifting.map((entry) => entry.record_type).join(', '),
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
  /** Whether this answer counts: its address counts, and the answer itself was authoritative and NOERROR/NXDOMAIN. */
  counted: boolean
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

/** A field as one address answered it, and whether that answer counts (authoritative, NOERROR or NXDOMAIN). */
type Read = { values: string[]; counts: boolean } | null

const soaField =
  (pick: (soa: NonNullable<Probe['soa']>) => string) =>
  (probe: Probe): Read =>
    probe.soa ? { values: [pick(probe.soa)], counts: true } : null

const MATRIX_ROWS: [string, (probe: Probe) => Read][] = [
  ['Serial', soaField((soa) => String(soa.serial))],
  ['Primary', soaField((soa) => soa.mname)],
  ['Contact', soaField((soa) => soa.rname)],
  [
    'Timers',
    soaField((soa) => `refresh ${soa.refresh} · retry ${soa.retry} · expire ${soa.expire} · min ${soa.minimum}`),
  ],
  ...['NS', 'A', 'AAAA', 'MX', 'TXT', 'CAA'].map((type): [string, (probe: Probe) => Read] => [
    type,
    (probe) => {
      const answer = probe.answers?.[type]
      if (!answer || answer.error) return null
      // A refused or failed query is shown as its rcode, and like a non-authoritative answer, doesn't count.
      if (answer.rcode !== 'NOERROR' && answer.rcode !== 'NXDOMAIN')
        return { values: [answer.rcode ?? 'no rcode'], counts: false }
      return {
        values: answer.rcode === 'NXDOMAIN' ? ['NXDOMAIN'] : (answer.values ?? []),
        counts: answer.authoritative !== false,
      }
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
    const reads = servers.map((probe, index): Read => {
      const found = probe.status === 'answered' ? read(probe) : null
      return found && { values: found.values, counts: found.counts && columns[index].counted }
    })
    const key = (cell: string[]) => cell.join('\n')
    const tally = new Map<string, number>()
    let consensus: string[] | undefined
    for (const cell of reads) {
      if (!cell?.counts) continue
      tally.set(key(cell.values), (tally.get(key(cell.values)) ?? 0) + 1)
      if (!consensus || (tally.get(key(cell.values)) ?? 0) > (tally.get(key(consensus)) ?? 0)) consensus = cell.values
    }
    const cells = reads.map((cell): MatrixCell | null => {
      if (cell === null) return null
      const differs = cell.counts && tally.size > 1 && consensus !== undefined && key(cell.values) !== key(consensus)
      return {
        values: cell.values,
        counted: cell.counts,
        differs,
        extra: differs ? cell.values.filter((value) => !consensus?.includes(value)) : [],
        missing: differs ? (consensus ?? []).filter((value) => !cell.values.includes(value)) : [],
      }
    })
    return { label, cells, differs: cells.some((cell) => cell?.differs) }
  })
  return { columns, rows, unrouted }
}

/**
 * The few fields worth reading first for each check; the full result is under it. `others` (the rest of the run's
 * results) lets a check be read against another: CT's issuers against the DNS check's CAA records.
 */
export function summary(
  check: Check,
  data: Record<string, unknown>,
  now = Date.now(),
  others?: Partial<Record<Check, CollectionResult>>,
): Row[] {
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
      const checks = at(data, 'certificate_checks') as Record<string, unknown> | null | undefined
      const suites = cipherRows(data)
      const worst = suites.some((suite) => suite.rating === 'insecure')
        ? 'insecure'
        : suites.some((suite) => suite.rating === 'weak')
          ? 'weak'
          : undefined
      const flagged = suites.filter((suite) => suite.rating === 'insecure' || suite.rating === 'weak')
      const weaknesses = vulnerabilities(data).filter((entry) => entry.status === 'vulnerable')
      const scanned = at(data, 'scan') != null
      // A scan cut short by its budget never tried some suites or versions: it can't read as clean.
      const complete = at(data, 'scan.complete') === true
      const partial = scanned && !complete ? ' (scan incomplete)' : ''
      const chainIssue =
        checks?.chain_complete === false
          ? 'incomplete (missing intermediate)'
          : checks?.untrusted_root === true
            ? 'ends at an untrusted root'
            : undefined
      return [
        { label: 'Protocol', value: str(at(data, 'connection.protocol')) },
        { label: 'Cipher', value: str(at(data, 'connection.cipher_name')) },
        {
          label: 'Versions',
          value: versions.join(', '),
          assessed: true,
          ...(legacy.length && { tone: 'warn', note: `Accepts legacy ${legacy.join(', ')}` }),
        },
        {
          label: 'Cipher suites',
          value: scanned ? `${suiteCounts(data)}${partial}` : undefined,
          optional: true,
          assessed: true,
          ...(worst === 'insecure'
            ? {
                tone: 'bad',
                note: `Insecure suites accepted: ${uniq(flagged.filter((s) => s.rating === 'insecure').map((s) => s.name)).join(', ')}`,
              }
            : worst === 'weak'
              ? { tone: 'warn', note: `Weak suites accepted: ${uniq(flagged.map((s) => s.name)).join(', ')}` }
              : scanned && (complete ? { tone: 'good' } : { tone: 'info', note: 'The cipher scan ran out of time' })),
        },
        {
          label: 'Server order',
          value: serverOrder(data),
          optional: true,
        },
        {
          label: 'Weaknesses',
          value: scanned
            ? weaknesses.map((entry) => entry.name).join(', ') || (complete ? 'none found' : 'none found so far')
            : undefined,
          optional: true,
          assessed: true,
          ...(weaknesses.some((entry) => entry.severity === 'high' || entry.severity === 'critical')
            ? { tone: 'bad', note: `Known weaknesses: ${weaknesses.map((entry) => entry.name).join(', ')}` }
            : weaknesses.length
              ? { tone: 'warn', note: `Known weaknesses: ${weaknesses.map((entry) => entry.name).join(', ')}` }
              : scanned &&
                (complete
                  ? { tone: 'good' }
                  : { tone: 'info', note: 'The cipher scan ran out of time; some checks were not settled' })),
        },
        { label: 'Subject', value: str(at(data, 'leaf_certificate.subject.common_name')) },
        {
          label: 'Names',
          value: names.length > 4 ? `${names.slice(0, 4).join(', ')} +${names.length - 4}` : names.join(', '),
          assessed: true,
          ...(checks?.hostname_matches === false && {
            tone: 'bad',
            note: 'The certificate is not valid for this name',
          }),
        },
        {
          label: 'Issuer',
          value: str(at(data, 'leaf_certificate.issuer.common_name')),
          assessed: true,
          ...(at(data, 'leaf_certificate.is_self_signed') === true && {
            tone: 'bad',
            note: 'The certificate is self-signed',
          }),
        },
        {
          label: 'Key',
          value: [str(at(data, 'leaf_certificate.key_type')), at(data, 'leaf_certificate.key_bits')]
            .filter(Boolean)
            .join(' '),
          optional: true,
        },
        {
          label: 'Expires',
          value: dated(expires, now),
          assessed: true,
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
                ? `not verified: ${chainIssue ?? at(data, 'chain_validation.reason') ?? '?'}`
                : chainIssue,
          tone: verified === true ? 'good' : 'bad',
          note: `The chain does not verify (${chainIssue ?? at(data, 'chain_validation.reason') ?? 'no reason given'})`,
          optional: true,
          assessed: true,
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
      const grade = str(at(data, 'assessment.grade'))
      const software = list(at(data, 'assessment.software'), (entry) =>
        entry.version ? `${entry.product} ${entry.version}${entry.end_of_life ? ' (end of life)' : ''}` : null,
      )
      const endOfLife = list(at(data, 'assessment.software'), (entry) =>
        entry.end_of_life ? `${entry.product} ${entry.version}` : null,
      )
      return [
        {
          label: 'Grade',
          value: grade && `${grade} (${at(data, 'assessment.score')})`,
          optional: true,
          ...(grade && {
            tone: /^A/.test(grade) ? 'good' : grade === 'B' ? 'info' : grade === 'F' ? 'bad' : 'warn',
            note: `HTTP best-practice grade ${grade}`,
          }),
        },
        {
          label: 'Status',
          value: status,
          ...(typeof status === 'number' && status >= 400 && { tone: 'warn', note: `The site answers HTTP ${status}` }),
        },
        { label: 'HTTP', value: str(at(data, 'http_version')) },
        { label: 'Server', value: str(at(data, 'server')) },
        {
          label: 'Versions exposed',
          value: software.join(', '),
          optional: true,
          assessed: true,
          ...(endOfLife.length
            ? { tone: 'bad', note: `End-of-life software: ${endOfLife.join(', ')}` }
            : { tone: 'info', note: 'Response headers name software versions' }),
        },
        {
          label: 'Final URL',
          value: str(at(data, 'final_url')) !== str(at(data, 'url')) ? str(at(data, 'final_url')) : undefined,
          optional: true,
        },
        { label: 'Redirects', value: redirects.length },
        {
          label: 'Port 80 → HTTPS',
          value: upgrade as boolean,
          assessed: true,
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
              assessed: true,
            }
          : { label: 'HSTS', value: 'none', tone: 'warn', note: 'No Strict-Transport-Security header', assessed: true },
        {
          label: 'Security headers',
          value: present.join(', ') || 'none',
          ...(!security.csp && { tone: 'info', note: 'No Content-Security-Policy' }),
        },
        { label: 'Cookies', value: list(at(data, 'cookies')).length },
      ]
    }
    case 'ct':
      return ctSummary(data, now, others?.dns?.ok ? (others.dns.data ?? undefined) : undefined)
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

/** A domaincheck assessment finding (schema 2.2+, tls and headers): high and critical are bad, medium is warn. Low and
 * info stay in the panel's own lists, so the strip above the panels holds only what deserves a look. */
const assessedTone = (severity: unknown): Finding['tone'] | undefined =>
  severity === 'critical' || severity === 'high' ? 'bad' : severity === 'medium' ? 'warn' : undefined

/** What deserves a look across a run's checks, worst first: each warn or bad row, and each check that failed. Where
 * domaincheck sent its own assessment, its findings stand in for the rows that say the same thing. */
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
    const assessed = Array.isArray(at(result.data, 'assessment.findings'))
    for (const row of visibleRows(summary(check, result.data, now, results))) {
      if (assessed && row.assessed) continue
      if (row.tone === 'warn' || row.tone === 'bad') found.push({ check, tone: row.tone, text: row.note ?? row.label })
    }
    if (assessed) {
      for (const item of list(at(result.data, 'assessment.findings'), (entry) => entry as unknown as Value)) {
        const entry = item as unknown as Record<string, unknown>
        const tone = assessedTone(entry.severity)
        if (tone) found.push({ check, tone, text: String(entry.title ?? entry.id) })
      }
    }
  }
  return found.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1))
}

// ---------------------------------------------------------------------------------------------------------------------
// TLS scan and HTTP assessment detail (domaincheck schema 2.2+), for the tables under the summaries.

const uniq = (items: string[]) => [...new Set(items)]

export interface CipherRow {
  version: string
  name: string
  rating: string
  group?: string
  issues: string[]
  tone: Tone
}

const ratingTone = (rating: string): Tone =>
  rating === 'insecure' ? 'bad' : rating === 'weak' ? 'warn' : rating === 'strong' ? 'good' : 'info'

/** Every accepted suite, newest protocol first, in the order the server prefers when it has one. */
export function cipherRows(data: Record<string, unknown>): CipherRow[] {
  const protocols = at(data, 'scan.protocols')
  if (!Array.isArray(protocols)) return []
  return protocols.flatMap((protocol: Record<string, unknown>) =>
    protocol.supported && Array.isArray(protocol.ciphers)
      ? protocol.ciphers.map((suite: Record<string, unknown>) => ({
          version: String(protocol.version),
          name: String(suite.name).replace(/^TLS_/, ''),
          rating: String(suite.rating ?? 'acceptable'),
          group: str(suite.key_exchange_group),
          issues: list(suite.issues).map(String),
          tone: ratingTone(String(suite.rating)),
        }))
      : [],
  )
}

/** "TLSv1.3: 3 · TLSv1.2: 13 (2 weak)". */
function suiteCounts(data: Record<string, unknown>) {
  const rows = cipherRows(data)
  return uniq(rows.map((row) => row.version))
    .map((version) => {
      const mine = rows.filter((row) => row.version === version)
      const bad = mine.filter((row) => row.rating === 'insecure').length
      const weak = mine.filter((row) => row.rating === 'weak').length
      const extra = [bad && `${bad} insecure`, weak && `${weak} weak`].filter(Boolean).join(', ')
      return `${version}: ${mine.length}${extra ? ` (${extra})` : ''}`
    })
    .join(' · ')
}

function serverOrder(data: Record<string, unknown>) {
  const protocols = at(data, 'scan.protocols')
  if (!Array.isArray(protocols)) return undefined
  const known = protocols.filter(
    (protocol: Record<string, unknown>) =>
      protocol.supported && protocol.version !== 'TLSv1.3' && typeof protocol.server_preference === 'boolean',
  )
  if (!known.length) return undefined
  return known.every((protocol: Record<string, unknown>) => protocol.server_preference)
    ? 'server picks'
    : known.some((protocol: Record<string, unknown>) => protocol.server_preference)
      ? 'mixed'
      : 'client picks'
}

export interface Vulnerability {
  id: string
  name: string
  status: string
  severity: string
  detail?: string
  tone: Tone
}

/** domaincheck's named weakness checks. Vulnerable is bad (warn for low severity); not tested and unknown are info. */
export function vulnerabilities(data: Record<string, unknown>): Vulnerability[] {
  const entries = at(data, 'assessment.vulnerabilities')
  if (!Array.isArray(entries)) return []
  return entries.map((entry: Record<string, unknown>) => {
    const status = String(entry.status)
    const severity = String(entry.severity ?? 'info')
    return {
      id: String(entry.id),
      name: String(entry.name),
      status,
      severity,
      detail: str(entry.detail),
      tone:
        status === 'vulnerable'
          ? severity === 'low' || severity === 'info'
            ? 'warn'
            : 'bad'
          : status === 'not_vulnerable'
            ? 'good'
            : 'info',
    }
  })
}

export interface HeaderCheck {
  name: string
  result: string
  value?: string
  detail?: string
  tone: Tone
}

/** domaincheck's best-practice checks of the response, one per header family. */
export function headerChecks(data: Record<string, unknown>): HeaderCheck[] {
  const checks = at(data, 'assessment.checks')
  if (!Array.isArray(checks)) return []
  return checks.map((check: Record<string, unknown>) => ({
    name: String(check.name),
    result: String(check.result),
    value: str(check.value),
    detail: str(check.detail),
    tone:
      check.result === 'pass' ? 'good' : check.result === 'fail' ? 'bad' : check.result === 'warn' ? 'warn' : 'info',
  }))
}

/** The assessment's lesser findings (low, info), which the strip above the panels leaves out. */
export function minorFindings(data: Record<string, unknown>): string[] {
  return list(at(data, 'assessment.findings'), (entry) =>
    entry.severity === 'low' || entry.severity === 'info' ? String(entry.title) : null,
  ).map(String)
}

// ---------------------------------------------------------------------------------------------------------------------
// Certificate Transparency (wwff-recon's own `ct` check, docs/contract.md "Certificate Transparency"): what the public
// CT logs hold for the name and its subdomains, from crt.sh, or Cert Spotter's current certificates when crt.sh fails.

const records = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]) : [])

const count = (value: unknown) => (typeof value === 'number' ? value : 0)

/**
 * The CAA issuer domains (RFC 8659) each common issuing organisation answers to, by its O= (or CN=) as CT records it.
 * An issuer not listed here is never judged against CAA: guessing would flag certificates that were fine.
 */
const CAA_IDS: [RegExp, string[]][] = [
  [/let'?s encrypt/i, ['letsencrypt.org']],
  [
    /digicert|geotrust|rapidssl|thawte|symantec|cloudflare/i,
    ['digicert.com', 'symantec.com', 'geotrust.com', 'rapidssl.com', 'thawte.com', 'digicert.ne.jp'],
  ],
  [
    /sectigo|comodo|usertrust|zerossl/i,
    ['sectigo.com', 'comodoca.com', 'comodo.com', 'usertrust.com', 'trust-provider.com', 'zerossl.com'],
  ],
  [/google trust services/i, ['pki.goog']],
  [/^amazon/i, ['amazon.com', 'amazontrust.com', 'awstrust.com', 'amazonaws.com']],
  [/globalsign/i, ['globalsign.com']],
  [/entrust/i, ['entrust.net', 'affirmtrust.com']],
  [/godaddy|starfield/i, ['godaddy.com', 'starfieldtech.com']],
  [/^ssl corp/i, ['ssl.com']],
  [/buypass/i, ['buypass.com', 'buypass.no']],
  [/certainly/i, ['certainly.com']],
  [/actalis/i, ['actalis.it']],
  [/harica|hellenic academic/i, ['harica.gr']],
]

/** The CAA domains an issuer answers to, or undefined when it isn't one this page knows. */
export const caaIdsFor = (issuer: string) => CAA_IDS.find(([pattern]) => pattern.test(issuer))?.[1]

export interface CaaPolicy {
  /** The name the DNS check walked up from: the only name (with its wildcard) whose relevant CAA set is known. */
  name: string
  /** The zone whose records are that set. */
  zone: string
  /** Issuer domains `issue` allows: empty when `issue ";"` forbids every CA, undefined when there's no `issue` tag
   * (any CA may issue for the name itself; RFC 8659 §4.2). */
  issue?: string[]
  /** The same for wildcards, or undefined when there's no `issuewild` (so `issue` applies; RFC 8659 §4.3). */
  issuewild?: string[]
}

/** The CAA set that applies to the name: the closest zone on the DNS check's upward walk with any records. */
export function caaPolicy(dns: Record<string, unknown> | undefined): CaaPolicy | undefined {
  const tree = records(at(dns, 'caa_tree'))
  const node = tree.find((entry) => records(entry.records).length > 0)
  if (!node) return undefined
  const values = (tag: string) =>
    records(node.records)
      .filter((record) => String(record.tag).toLowerCase() === tag)
      .map((record) =>
        String(record.value ?? '')
          .split(';')[0]
          .trim()
          .toLowerCase(),
      )
  const issue = values('issue')
  const wild = values('issuewild')
  // Only issue/issuewild limit issuance; a set of iodef alone allows any CA.
  if (!issue.length && !wild.length) return undefined
  return {
    name: String(tree[0].zone).toLowerCase().replace(/\.$/, ''),
    zone: String(node.zone),
    ...(issue.length && { issue: issue.filter(Boolean) }),
    ...(wild.length && { issuewild: wild.filter(Boolean) }),
  }
}

/** The issuer domains CAA allows for one certificate name, undefined when any CA may issue, or 'unknown' when the
 * name's relevant CAA set isn't the one the DNS check found (a subdomain may have its own). */
function allowedFor(name: string, policy: CaaPolicy): string[] | undefined | 'unknown' {
  const bare = name.toLowerCase().replace(/\.$/, '')
  if (bare === `*.${policy.name}`) return policy.issuewild ?? policy.issue
  if (bare === policy.name) return policy.issue
  return 'unknown'
}

export interface CaaConflict {
  issuer: string
  certificates: number
}

/**
 * Current certificates whose issuer today's CAA records don't allow, per issuer. Each name on a certificate is judged
 * on its own (a wildcard by issuewild, the name itself by issue), and only the checked name and its wildcard: other
 * subdomains may have CAA sets of their own, which the DNS check didn't look up. CAA is checked at issuance, so a
 * conflict can mean the records changed since; either way, that CA could not issue for the name now.
 */
export function caaConflicts(ct: Record<string, unknown>, dns: Record<string, unknown> | undefined): CaaConflict[] {
  const policy = caaPolicy(dns)
  if (!policy) return []
  const found = new Map<string, number>()
  for (const cert of records(at(ct, 'certificates'))) {
    if (cert.current !== true) continue
    const issuer = String(cert.issuer_name ?? '')
    const ids = caaIdsFor(issuer)
    if (!ids) continue
    const refused = list(cert.names).some((name) => {
      const allowed = allowedFor(String(name), policy)
      return allowed !== 'unknown' && allowed !== undefined && !ids.some((id) => allowed.includes(id))
    })
    if (refused) found.set(issuer, (found.get(issuer) ?? 0) + 1)
  }
  return [...found].map(([issuer, certificates]) => ({ issuer, certificates }))
}

function ctSummary(data: Record<string, unknown>, now: number, dns: Record<string, unknown> | undefined): Row[] {
  const history = at(data, 'history') === true
  const total = count(at(data, 'total'))
  const current = count(at(data, 'current'))
  const issuers = records(at(data, 'issuers'))
  const names = records(at(data, 'names'))
  const certs = records(at(data, 'certificates'))
  const recent = certs.filter((cert) => {
    const issued = time(cert.not_before)
    return issued !== undefined && now - issued < 30 * DAY && issued <= now
  }).length
  const wildcards = names.filter((name) => name.wildcard === true && count(name.current) > 0).length
  const policy = caaPolicy(dns)
  const conflicts = caaConflicts(data, dns)
  const fallback = str(at(data, 'fallback_reason'))
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  return [
    {
      label: 'Source',
      value: history ? 'crt.sh (every logged certificate)' : 'Cert Spotter (current certificates only)',
      ...(fallback && { tone: 'info', note: `crt.sh failed (${fallback}), so only current certificates are listed` }),
    },
    {
      label: 'Certificates',
      value: history
        ? `${total}${at(data, 'truncated') === true ? ` (newest ${certs.length} kept)` : ''}: ${current} current, ${count(at(data, 'expired'))} expired`
        : `${current} current`,
      ...(current === 0 && { tone: 'info', note: 'The CT logs hold no current certificate for this name' }),
    },
    { label: 'First logged', value: history ? isoDate(time(at(data, 'first_issued'))) : undefined, optional: true },
    { label: 'Last issued', value: dated(time(at(data, 'last_issued')), now) },
    { label: 'Issued in 30 days', value: recent || undefined, optional: true },
    {
      label: 'Current issuers',
      value: issuers
        .filter((issuer) => count(issuer.current) > 0)
        .map((issuer) => `${issuer.name} (${issuer.current})`)
        .join(', '),
      optional: true,
    },
    { label: 'Issuers ever', value: history ? issuers.length : undefined, optional: true },
    {
      label: 'Names covered',
      value: names.length
        ? `${names.length}${at(data, 'names_truncated') === true ? '+' : ''} (${names.filter((name) => count(name.current) > 0).length} current)`
        : undefined,
      optional: true,
    },
    {
      label: 'Wildcards',
      value: wildcards ? `${plural(wildcards, 'current wildcard name')}` : undefined,
      tone: 'info',
      note: 'A current wildcard certificate covers every subdomain at that level',
      optional: true,
    },
    {
      label: 'CAA',
      value: !policy
        ? undefined
        : conflicts.length
          ? `not allowed: ${conflicts.map((entry) => `${entry.issuer} (${entry.certificates})`).join(', ')}`
          : current > 0
            ? `current issuers allowed for ${policy.name} (CAA at ${policy.zone})`
            : undefined,
      optional: true,
      ...(conflicts.length
        ? {
            tone: 'warn',
            note: `Current certificates from ${conflicts.map((entry) => entry.issuer).join(', ')}, which the CAA records at ${policy?.zone} don't allow`,
          }
        : { tone: 'good' }),
    },
    {
      label: 'Shared with',
      value: count(at(data, 'other_names'))
        ? plural(count(at(data, 'other_names')), 'name outside this domain')
        : undefined,
      optional: true,
    },
  ]
}

export interface CtIssuerRow {
  name: string
  current: number
  total: number
  first?: string
  last?: string
}

export const ctIssuers = (data: Record<string, unknown>): CtIssuerRow[] =>
  records(at(data, 'issuers')).map((issuer) => ({
    name: String(issuer.name),
    current: count(issuer.current),
    total: count(issuer.total),
    first: isoDate(time(issuer.first_issued)),
    last: isoDate(time(issuer.last_issued)),
  }))

export interface CtNameRow {
  name: string
  current: number
  total: number
  last?: string
  wildcard: boolean
}

/** Every name the logged certificates cover within the domain, current ones first: subdomains, found passively. */
export const ctNames = (data: Record<string, unknown>): CtNameRow[] =>
  records(at(data, 'names')).map((name) => ({
    name: String(name.name),
    current: count(name.current),
    total: count(name.total),
    last: isoDate(time(name.last_issued)),
    wildcard: name.wildcard === true,
  }))

export interface CtCertRow {
  key: string
  issued?: string
  expires?: string
  issuer: string
  names: string[]
  current: boolean
  url?: string
}

export const ctCertificates = (data: Record<string, unknown>): CtCertRow[] =>
  records(at(data, 'certificates')).map((cert, index) => ({
    key: `${cert.id ?? ''}:${cert.serial ?? ''}:${index}`,
    issued: isoDate(time(cert.not_before)),
    expires: isoDate(time(cert.not_after)),
    issuer: String(cert.issuer_name ?? cert.issuer ?? ''),
    names: list(cert.names).map(String),
    current: cert.current === true,
    // Only crt.sh's own pages: the link comes from the service, but check it is what it says.
    url: str(cert.url)?.startsWith('https://crt.sh/?id=') ? str(cert.url) : undefined,
  }))
