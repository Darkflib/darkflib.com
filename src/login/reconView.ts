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
        {
          label: 'Lame delegations',
          value: lame.length || undefined,
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
    for (const row of visibleRows(summary(check, result.data, now))) {
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
