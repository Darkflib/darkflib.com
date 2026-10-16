// What /tools/page/ shows of a page recon run (wwff-pagerecon docs/contract.md, "A run"): a summary row per thing
// worth reading in each section, the tone of each (so the page can mark what deserves a look), the findings drawn
// from them, and the tables the full data is shown in. No DOM and no imports, so the unit tests run it headless.
// The result is read loosely: a missing field is "—", not an error.

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

export type SectionId =
  | 'document'
  | 'security'
  | 'metadata'
  | 'structure'
  | 'links'
  | 'images'
  | 'styles'
  | 'timing'
  | 'requests'
  | 'libraries'

export interface Section {
  id: SectionId
  name: string
  rows: Row[]
}

export interface Finding {
  section: SectionId
  tone: 'warn' | 'bad'
  text: string
}

export interface PageRequest {
  url: string
  method: string
  type: string
  status: number | null
  mime: string | null
  bytes: number | null
  host: string | null
  third_party: boolean | null
  failure: string | null
  ms: number | null
}

export interface Blocked {
  host: string
  port: number
  ip: string | null
  reason: string
}

export interface Link {
  href: string
  text: string
  rel: string[]
  target: string | null
  scheme: string
  internal: boolean
  status: number | null
}

export interface Image {
  src: string
  alt: string | null
  has_alt: boolean
  width: number | null
  height: number | null
  natural_width: number | null
  natural_height: number | null
  loading: string | null
  format: string | null
  bytes: number | null
}

export interface Library {
  name: string
  version: string | null
  source: 'global' | 'url' | 'meta' | string
}

export interface Screenshot {
  width: number
  height: number
  bytes: number
  url: string
  truncated?: boolean
}

/** The contract's `result`. Every section may be null (the page couldn't provide it, or the load failed). */
export interface PageResult {
  ok: boolean
  error: { kind: string; retryable: boolean; message: string } | null
  duration_ms: number
  final_url: string | null
  notes: string[]
  document: {
    status: number
    url: string
    redirects: { url: string; status: number | null; location: string | null }[]
    headers: [string, string][]
    remote: { ip: string; port: number } | null
    tls: { protocol?: string; issuer?: string; subject?: string; valid_from?: number; valid_to?: number } | null
  } | null
  screenshots: { viewport: Screenshot | null; full_page: Screenshot | null } | null
  metadata: {
    title: string | null
    lang: string | null
    charset: string | null
    viewport: string | null
    description: string | null
    canonical: string | null
    robots: string | null
    generator: string | null
    theme_color: string | null
    icons: { rel: string | null; href: string | null; sizes: string | null; type: string | null }[]
    meta: { key: string; content: string | null }[]
    open_graph: Record<string, string | null>
    twitter: Record<string, string | null>
    json_ld: { types: string[]; valid: boolean; data: unknown }[]
  } | null
  structure: {
    headings: { level: number; text: string | null }[]
    landmarks: { role: string; label: string | null }[]
    word_count: number
    forms: number
    iframes: { src: string | null; sandbox: string | null; title: string | null }[]
    scripts: { external: number; inline: number; module: number; async_or_defer: number }
  } | null
  links: Link[] | null
  styles: {
    stylesheets: { href: string | null; media: string | null; rules: number | null }[]
    inline_style_blocks: number
    inline_style_attributes: number
    fonts: { family: string | null; weight: string | null; style: string | null; status: string }[]
  } | null
  images: Image[] | null
  timing: {
    ttfb_ms: number | null
    dom_interactive_ms: number | null
    dom_content_loaded_ms: number | null
    load_ms: number | null
    first_contentful_paint_ms: number | null
    largest_contentful_paint_ms: number | null
    cumulative_layout_shift: number | null
    transfer_bytes: number | null
    resource_count: number | null
  } | null
  requests: PageRequest[]
  blocked: Blocked[]
  libraries: Library[] | null
  csp: {
    header: string | null
    report_only: string | null
    meta: string[]
    violations: { directive: string | null; blocked: string }[]
  } | null
  console_errors: string[]
  budget: { bytes: number; bytes_limit: number; requests: number; requests_limit: number; exceeded: boolean } | null
}

export const SECTION_NAMES: Record<SectionId, string> = {
  document: 'DOCUMENT',
  security: 'HEADERS & CSP',
  metadata: 'METADATA',
  structure: 'STRUCTURE',
  links: 'LINKS',
  images: 'IMAGES',
  styles: 'STYLES & FONTS',
  timing: 'TIMING',
  requests: 'REQUESTS',
  libraries: 'LIBRARIES',
}

const DAY = 86_400_000

/** What a row's value reads as. */
export function show(value: Value): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

/**
 * Each item with a React key that's unique even when items repeat (the same request twice, two empty headings): its
 * own key, then #2, #3… for repeats.
 */
export function keyed<T>(items: T[], key: (item: T) => string): { key: string; item: T }[] {
  const seen = new Map<string, number>()
  return items.map((item) => {
    const base = key(item)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { key: n === 1 ? base : `${base}#${n}`, item }
  })
}

export const visibleRows = (rows: Row[]) =>
  rows.filter((row) => !(row.optional && (row.value === undefined || row.value === null || row.value === '')))

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

/** 1234567 -> "1.2 MB". */
export function bytes(n: number | null | undefined): string | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return undefined
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const ms = (n: number | null | undefined) => (typeof n === 'number' ? `${Math.round(n)} ms` : undefined)

/**
 * Turns whatever the user typed or pasted into the URL the service expects: a scheme when there's none (https), no
 * fragment, no surrounding space. The service still validates it.
 */
export function normaliseUrl(input: string): string {
  let text = input.trim()
  if (!text) return ''
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text) || /^[^:/]+:\d+(\/|$)/.test(text)) text = `https://${text}`
  return text.replace(/#.*$/, '')
}

/** The value of a response header (lower-case name), repeats joined as the browser would. */
export function header(headers: [string, string][] | undefined, name: string): string | undefined {
  const values = (headers ?? []).filter(([n]) => n === name).map(([, v]) => v)
  return values.length ? values.join(', ') : undefined
}

/** A CSP as directive -> sources. */
export function parseCsp(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/)
    if (name && !out.has(name.toLowerCase())) out.set(name.toLowerCase(), sources)
  }
  return out
}

/** What's weak about a CSP, worst first: each a tone and a sentence. */
export function cspGaps(policy: string): { tone: Tone; text: string }[] {
  const csp = parseCsp(policy)
  const gaps: { tone: Tone; text: string }[] = []
  const scripts = csp.get('script-src') ?? csp.get('default-src')
  if (!scripts) {
    gaps.push({ tone: 'warn', text: 'The CSP has no script-src or default-src, so scripts are unrestricted' })
  } else {
    const keyed = scripts.some((s) => /^'(nonce-|sha(256|384|512)-|strict-dynamic')/.test(s))
    if (scripts.includes("'unsafe-inline'") && !keyed)
      gaps.push({ tone: 'warn', text: "The CSP allows inline scripts ('unsafe-inline' with no nonce or hash)" })
    if (scripts.includes("'unsafe-eval'")) gaps.push({ tone: 'warn', text: "The CSP allows eval ('unsafe-eval')" })
    const wide = scripts.filter((s) => s === '*' || s === 'https:' || s === 'http:' || s === 'data:')
    if (wide.length && !scripts.includes("'strict-dynamic'"))
      gaps.push({ tone: 'warn', text: `The CSP lets scripts load from anywhere (${wide.join(' ')})` })
  }
  const objects = csp.get('object-src') ?? csp.get('default-src')
  if (!objects || !(objects.includes("'none'") || (objects.length === 1 && objects[0] === "'self'")))
    gaps.push({ tone: 'info', text: "The CSP doesn't restrict plugins (object-src 'none')" })
  if (!csp.has('base-uri')) gaps.push({ tone: 'info', text: 'The CSP has no base-uri' })
  return gaps
}

/**
 * Whether other sites can frame the page, judged by what browsers enforce: `frame-ancestors` only from a CSP header
 * (browsers ignore it in a meta tag) and only when it names no wildcard or bare scheme (when it's set, browsers ignore
 * X-Frame-Options); without it, X-Frame-Options only when it's DENY or SAMEORIGIN (any other value, or conflicting repeats, allows framing). Answers how it's protected, or
 * null when it isn't.
 */
export function framingProtection(
  cspHeader: string | null | undefined,
  frameOptions: string | undefined,
): string | null {
  const ancestors = cspHeader ? parseCsp(cspHeader).get('frame-ancestors') : undefined
  if (ancestors) {
    const open = ancestors.some((s) => s === '*' || /^[a-z][a-z0-9+.-]*:$/i.test(s) || /^(https?:\/\/)?\*$/i.test(s))
    // With frame-ancestors set, browsers ignore X-Frame-Options altogether.
    return open ? null : `frame-ancestors ${ancestors.join(' ') || "(empty: 'none')"}`
  }
  const values = [...new Set((frameOptions ?? '').split(',').map((v) => v.trim().toUpperCase()))].filter(Boolean)
  if (values.length === 1 && (values[0] === 'DENY' || values[0] === 'SAMEORIGIN')) return `X-Frame-Options ${values[0]}`
  return null
}

/** Versions worth more than a mention. Deliberately short: well-known, long-settled cases only. */
export function libraryRisk(lib: Library): { tone: Tone; note: string } | null {
  const v = lib.version?.match(/^(\d+)\.(\d+)(?:\.(\d+))?/)
  const [major, minor] = v ? [Number(v[1]), Number(v[2])] : [Number.NaN, Number.NaN]
  switch (lib.name) {
    case 'jQuery':
      if (major < 3 || (major === 3 && minor < 5))
        return { tone: 'bad', note: `jQuery ${lib.version} has known XSS flaws (fixed in 3.5.0)` }
      break
    case 'jQuery UI':
      if (major < 1 || (major === 1 && minor < 13))
        return { tone: 'warn', note: `jQuery UI ${lib.version} has known XSS flaws (fixed in 1.13)` }
      break
    case 'AngularJS':
      return { tone: 'warn', note: `AngularJS${lib.version ? ` ${lib.version}` : ''} reached end of life in 2022` }
    case 'Bootstrap':
      if (major < 4) return { tone: 'warn', note: `Bootstrap ${lib.version} is end of life (and has XSS flaws)` }
      break
    case 'Moment.js':
      return { tone: 'info', note: 'Moment.js is in maintenance mode' }
    case 'Prototype':
    case 'MooTools':
      return { tone: 'warn', note: `${lib.name} is long unmaintained` }
  }
  return null
}

function tlsRows(tls: NonNullable<PageResult['document']>['tls'], now: number): Row[] {
  if (!tls) return []
  const left = typeof tls.valid_to === 'number' ? Math.floor((tls.valid_to * 1000 - now) / DAY) : undefined
  return [
    { label: 'TLS', value: tls.protocol, tone: tls.protocol && /1\.[01]$/.test(tls.protocol) ? 'warn' : undefined },
    { label: 'Issuer', value: tls.issuer, optional: true },
    {
      label: 'Certificate expires',
      value:
        typeof tls.valid_to === 'number'
          ? `${new Date(tls.valid_to * 1000).toISOString().slice(0, 10)} (in ${left} days)`
          : undefined,
      ...(left !== undefined &&
        (left < 14
          ? { tone: 'bad' as const, note: `The certificate expires in ${left} days` }
          : left < 30 && { tone: 'warn' as const, note: `The certificate expires in ${left} days` })),
    },
  ]
}

/** Rows for one section of a loaded page. */
export function summary(id: SectionId, r: PageResult, now = Date.now()): Row[] {
  const doc = r.document
  const https = (r.final_url ?? doc?.url ?? '').startsWith('https:')
  switch (id) {
    case 'document': {
      if (!doc) return []
      const hops = doc.redirects.length
      return [
        {
          label: 'Status',
          value: doc.status,
          tone: doc.status >= 400 ? 'bad' : doc.status >= 300 ? 'warn' : 'good',
          note: doc.status >= 400 ? `The page answered ${doc.status}` : undefined,
        },
        { label: 'Final URL', value: r.final_url ?? doc.url },
        {
          label: 'Redirects',
          value: hops ? doc.redirects.map((hop) => `${hop.status ?? '?'} ${hop.url}`).join(' → ') : 'none',
          ...(hops > 2 && { tone: 'warn' as const, note: `${plural(hops, 'redirect')} before the page` }),
        },
        {
          label: 'Scheme',
          value: https ? 'https' : 'http',
          tone: https ? 'good' : 'bad',
          note: https ? undefined : 'The page is served over plain HTTP',
        },
        ...tlsRows(doc.tls, now),
        { label: 'Server address', value: doc.remote ? `${doc.remote.ip}:${doc.remote.port}` : undefined },
        { label: 'Content type', value: header(doc.headers, 'content-type') },
        { label: 'Server', value: header(doc.headers, 'server'), optional: true },
      ]
    }
    case 'security': {
      if (!doc) return []
      const h = doc.headers
      const csp = r.csp
      const enforced = csp?.header ?? (csp?.meta.length ? csp.meta.join(', ') : undefined)
      const frameOptions = header(h, 'x-frame-options')
      const gaps = enforced ? cspGaps(enforced) : []
      const framing = framingProtection(csp?.header, frameOptions)
      const hsts = header(h, 'strict-transport-security')
      const maxAge = Number(hsts?.match(/max-age=(\d+)/i)?.[1] ?? Number.NaN)
      const server = header(h, 'server')
      const powered = header(h, 'x-powered-by')
      const cookies = h.filter(([n]) => n === 'set-cookie').map(([, v]) => v)
      const insecure = cookies.filter((c) => https && !/;\s*secure/i.test(c))
      const scriptable = cookies.filter((c) => !/;\s*httponly/i.test(c))
      const nameOf = (cookie: string) => cookie.split('=')[0]?.trim()
      return [
        {
          label: 'CSP',
          value: enforced ? (csp?.header ? 'header' : 'meta tag') : csp?.report_only ? 'report-only' : 'none',
          ...(!enforced
            ? {
                tone: 'warn' as const,
                note: csp?.report_only ? 'The CSP is report-only: nothing is enforced' : 'No Content-Security-Policy',
              }
            : { tone: gaps.some((g) => g.tone === 'warn') ? ('info' as const) : ('good' as const) }),
        },
        ...gaps.map((gap) => ({
          label: 'CSP gap',
          value: gap.text,
          tone: gap.tone,
          note: gap.text,
        })),
        {
          label: 'CSP violations',
          value: csp?.violations.length ? plural(csp.violations.length, 'violation') : undefined,
          tone: 'info',
          optional: true,
        },
        {
          label: 'HSTS',
          value: hsts ?? (https ? 'none' : undefined),
          ...(https && !hsts
            ? { tone: 'warn' as const, note: 'No Strict-Transport-Security header' }
            : Number.isFinite(maxAge) && maxAge < 15_552_000
              ? { tone: 'info' as const, note: 'HSTS max-age is under 180 days' }
              : hsts && { tone: 'good' as const }),
          optional: !https,
        },
        {
          label: 'X-Content-Type-Options',
          value: header(h, 'x-content-type-options') ?? 'none',
          tone: header(h, 'x-content-type-options') ? 'good' : 'info',
        },
        {
          label: 'Referrer-Policy',
          value: header(h, 'referrer-policy') ?? 'none',
          tone: header(h, 'referrer-policy') ? 'good' : 'info',
        },
        { label: 'Permissions-Policy', value: header(h, 'permissions-policy'), optional: true },
        { label: 'X-Frame-Options', value: frameOptions, optional: true },
        {
          label: 'Framing',
          value: framing ? `only as allowed (${framing})` : 'any site',
          ...(framing
            ? { tone: 'good' as const }
            : {
                tone: 'warn' as const,
                note: 'Any site can frame the page (no effective frame-ancestors header or X-Frame-Options)',
              }),
        },
        {
          label: 'Server version',
          value: server && /\d/.test(server) ? server : undefined,
          tone: 'warn',
          note: `The Server header exposes a version (${server})`,
          optional: true,
        },
        {
          label: 'X-Powered-By',
          value: powered,
          tone: 'warn',
          note: `X-Powered-By exposes the stack (${powered})`,
          optional: true,
        },
        {
          label: 'Cookies',
          value: cookies.length ? plural(cookies.length, 'cookie') : undefined,
          optional: true,
        },
        {
          label: 'Cookies without Secure',
          value: insecure.map(nameOf).join(', '),
          tone: 'warn',
          note: `Cookies sent without Secure: ${insecure.map(nameOf).join(', ')}`,
          optional: true,
        },
        {
          label: 'Cookies scripts can read',
          value: scriptable.map(nameOf).join(', '),
          tone: 'info',
          optional: true,
        },
      ]
    }
    case 'metadata': {
      const m = r.metadata
      if (!m) return []
      const og = m.open_graph ?? {}
      const tw = m.twitter ?? {}
      const ogKeys = Object.keys(og)
      const missingOg = ['og:title', 'og:image'].filter((k) => !og[k])
      const invalidLd = m.json_ld.filter((j) => !j.valid).length
      const titleLength = m.title?.length ?? 0
      const descLength = m.description?.length ?? 0
      return [
        {
          label: 'Title',
          value: m.title,
          ...(!m.title
            ? { tone: 'bad' as const, note: 'The page has no <title>' }
            : (titleLength < 10 || titleLength > 70) && {
                tone: 'info' as const,
                note: `The title is ${titleLength} characters`,
              }),
        },
        {
          label: 'Description',
          value: m.description,
          ...(!m.description
            ? { tone: 'warn' as const, note: 'No meta description' }
            : descLength > 170 && { tone: 'info' as const, note: `The description is ${descLength} characters` }),
        },
        {
          label: 'Language',
          value: m.lang,
          ...(!m.lang && { tone: 'warn' as const, note: 'No lang on <html>' }),
        },
        {
          label: 'Viewport',
          value: m.viewport,
          ...(!m.viewport && { tone: 'warn' as const, note: 'No viewport meta tag: phones render it zoomed out' }),
        },
        { label: 'Canonical', value: m.canonical },
        {
          label: 'Robots',
          value: m.robots,
          ...(m.robots &&
            /noindex/i.test(m.robots) && { tone: 'warn' as const, note: 'The page asks not to be indexed' }),
          optional: true,
        },
        {
          label: 'Open Graph',
          value: ogKeys.length ? ogKeys.join(', ') : 'none',
          ...(missingOg.length === 2
            ? { tone: 'warn' as const, note: 'No Open Graph tags: links to it unfurl poorly' }
            : missingOg.length
              ? { tone: 'warn' as const, note: `Open Graph without ${missingOg.join(' or ')}` }
              : { tone: 'good' as const }),
        },
        {
          label: 'Twitter card',
          value: tw['twitter:card'] ?? 'none',
          tone: tw['twitter:card'] ? 'good' : 'info',
        },
        {
          label: 'JSON-LD',
          value: m.json_ld.length
            ? m.json_ld.map((j) => (j.valid ? j.types.join('+') || 'untyped' : 'invalid')).join(', ')
            : 'none',
          ...(invalidLd > 0 && { tone: 'warn' as const, note: `${plural(invalidLd, 'JSON-LD block')} didn't parse` }),
        },
        { label: 'Generator', value: m.generator, optional: true },
        { label: 'Icons', value: m.icons.length ? plural(m.icons.length, 'icon') : 'none' },
      ]
    }
    case 'structure': {
      const s = r.structure
      if (!s) return []
      const h1 = s.headings.filter((h) => h.level === 1).length
      const skips = s.headings.filter((h, i) => i > 0 && h.level > (s.headings[i - 1]?.level ?? 0) + 1).length
      const roles = new Set(s.landmarks.map((l) => l.role))
      return [
        {
          label: 'H1',
          value: h1,
          ...(h1 === 0
            ? { tone: 'warn' as const, note: 'No <h1>' }
            : h1 > 1 && { tone: 'info' as const, note: `${h1} <h1> elements` }),
        },
        { label: 'Headings', value: s.headings.length },
        {
          label: 'Heading levels skipped',
          value: skips || undefined,
          tone: 'info',
          note: `The outline skips a level ${plural(skips, 'time')}`,
          optional: true,
        },
        {
          label: 'Landmarks',
          value: s.landmarks.length ? [...roles].join(', ') : 'none',
          ...(!roles.has('main') && { tone: 'warn' as const, note: 'No main landmark' }),
        },
        { label: 'Words', value: s.word_count },
        { label: 'Forms', value: s.forms || undefined, optional: true },
        {
          label: 'Iframes',
          value: s.iframes.length
            ? `${s.iframes.length} (${s.iframes.filter((f) => f.sandbox !== null).length} sandboxed)`
            : undefined,
          optional: true,
        },
        {
          label: 'Scripts',
          value: `${s.scripts.external} external, ${s.scripts.inline} inline`,
          ...(s.scripts.external > 0 &&
            s.scripts.async_or_defer < s.scripts.external && {
              tone: 'info' as const,
              note: `${s.scripts.external - s.scripts.async_or_defer} external scripts block parsing`,
            }),
        },
      ]
    }
    case 'links': {
      const links = r.links ?? []
      const web = links.filter((l) => l.scheme === 'http' || l.scheme === 'https')
      const internal = web.filter((l) => l.internal).length
      const checked = links.filter((l) => l.status !== null)
      const broken = checked.filter((l) => l.status === 0 || (l.status ?? 0) >= 400)
      const blank = links.filter(
        (l) => l.target === '_blank' && !l.rel.some((x) => x === 'noopener' || x === 'noreferrer'),
      )
      const insecure = https ? web.filter((l) => l.scheme === 'http').length : 0
      return [
        { label: 'Links', value: links.length },
        { label: 'Internal / external', value: `${internal} / ${web.length - internal}` },
        { label: 'Other schemes', value: links.length - web.length || undefined, optional: true },
        {
          label: 'Checked',
          value: checked.length ? `${checked.length}, ${broken.length} broken` : 'none',
          ...(broken.length > 0 && {
            tone: 'warn' as const,
            note: `${plural(broken.length, 'broken internal link')}: ${broken
              .slice(0, 3)
              .map((l) => `${l.href} (${l.status || 'no answer'})`)
              .join(', ')}${broken.length > 3 ? ', …' : ''}`,
          }),
        },
        {
          label: 'Links to http://',
          value: insecure || undefined,
          tone: 'info',
          optional: true,
        },
        {
          label: '_blank without noopener',
          value: blank.length || undefined,
          tone: 'info',
          optional: true,
        },
        {
          label: 'nofollow / sponsored / ugc',
          value:
            links.filter((l) => l.rel.some((x) => x === 'nofollow' || x === 'sponsored' || x === 'ugc')).length ||
            undefined,
          optional: true,
        },
      ]
    }
    case 'images': {
      const images = r.images ?? []
      const noAlt = images.filter((i) => !i.has_alt)
      const heavy = images.filter((i) => (i.bytes ?? 0) > 500 * 1024)
      const legacy = images.filter((i) => (i.format === 'jpeg' || i.format === 'png') && (i.bytes ?? 0) > 100 * 1024)
      const oversized = images.filter(
        (i) => i.width && i.natural_width && i.natural_width > i.width * 2.5 && i.natural_width > 800,
      )
      const formats = [...new Set(images.map((i) => i.format).filter(Boolean))]
      const total = images.reduce((n, i) => n + (i.bytes ?? 0), 0)
      return [
        { label: 'Images', value: images.length },
        {
          label: 'Without alt',
          value: noAlt.length,
          ...(noAlt.length > 0
            ? { tone: 'warn' as const, note: `${plural(noAlt.length, 'image')} without alt text` }
            : images.length > 0 && { tone: 'good' as const }),
        },
        { label: 'Formats', value: formats.join(', '), optional: true },
        { label: 'Total size', value: bytes(total) },
        {
          label: 'Over 500 KB',
          value: heavy.length || undefined,
          tone: 'warn',
          note: `${plural(heavy.length, 'image')} over 500 KB`,
          optional: true,
        },
        {
          label: 'Could be WebP/AVIF',
          value: legacy.length || undefined,
          tone: 'info',
          optional: true,
        },
        {
          label: 'Much larger than shown',
          value: oversized.length || undefined,
          tone: 'info',
          optional: true,
        },
        {
          label: 'Lazy-loaded',
          value: images.length ? images.filter((i) => i.loading === 'lazy').length : undefined,
          optional: true,
        },
      ]
    }
    case 'styles': {
      const s = r.styles
      if (!s) return []
      const families = [...new Set(s.fonts.map((f) => f.family).filter(Boolean))]
      const fontHosts = [
        ...new Set(r.requests.filter((q) => q.type === 'font' && q.third_party).map((q) => q.host)),
      ].filter(Boolean)
      const failed = s.fonts.filter((f) => f.status === 'error').length
      return [
        { label: 'Stylesheets', value: s.stylesheets.filter((x) => x.href).length },
        { label: '<style> blocks', value: s.inline_style_blocks },
        {
          label: 'style attributes',
          value: s.inline_style_attributes,
          ...(s.inline_style_attributes > 100 && {
            tone: 'info' as const,
            note: `${s.inline_style_attributes} inline style attributes`,
          }),
        },
        { label: 'Font families', value: families.join(', ') || 'none' },
        { label: 'Font hosts', value: fontHosts.join(', '), tone: 'info', optional: true },
        {
          label: 'Fonts that failed',
          value: failed || undefined,
          tone: 'warn',
          note: `${plural(failed, 'font')} failed to load`,
          optional: true,
        },
      ]
    }
    case 'timing': {
      const t = r.timing
      if (!t) return []
      const grade = (v: number | null, good: number, poor: number, what: string, fmt = ms): Row => ({
        label: what,
        value: fmt(v),
        ...(typeof v === 'number' &&
          (v <= good
            ? { tone: 'good' as const }
            : v <= poor
              ? { tone: 'info' as const }
              : { tone: 'warn' as const, note: `${what} is ${fmt(v)} (poor past ${fmt(poor)})` })),
      })
      return [
        grade(t.ttfb_ms, 800, 1800, 'Time to first byte'),
        grade(t.first_contentful_paint_ms, 1800, 3000, 'First contentful paint'),
        grade(t.largest_contentful_paint_ms, 2500, 4000, 'Largest contentful paint'),
        grade(t.cumulative_layout_shift, 0.1, 0.25, 'Layout shift (CLS)', (v) =>
          typeof v === 'number' ? v.toFixed(3) : undefined,
        ),
        { label: 'DOM content loaded', value: ms(t.dom_content_loaded_ms) },
        { label: 'Load', value: ms(t.load_ms) },
        { label: 'Transferred', value: bytes(t.transfer_bytes), optional: true },
      ]
    }
    case 'requests': {
      const q = r.requests
      const third = q.filter((x) => x.third_party)
      const total = q.reduce((n, x) => n + (x.bytes ?? 0), 0)
      const thirdBytes = third.reduce((n, x) => n + (x.bytes ?? 0), 0)
      const thirdHosts = new Set(third.map((x) => x.host))
      const mixed = https ? q.filter((x) => x.url.startsWith('http://')) : []
      const errors = q.filter((x) => (x.status ?? 0) >= 400)
      const failed = q.filter((x) => x.failure && x.failure !== 'csp')
      const blocked = r.blocked
      return [
        { label: 'Requests', value: q.length },
        { label: 'Received', value: bytes(total) },
        {
          label: 'Third-party hosts',
          value: thirdHosts.size,
          ...(thirdHosts.size > 15 && {
            tone: 'warn' as const,
            note: `${thirdHosts.size} third-party hosts`,
          }),
        },
        {
          label: 'Third-party share',
          value: q.length
            ? `${Math.round((third.length / q.length) * 100)}% of requests, ${bytes(thirdBytes)}`
            : undefined,
          ...(q.length >= 10 &&
            (third.length / q.length > 0.5 || (total > 0 && thirdBytes / total > 0.5)) && {
              tone: 'warn' as const,
              note: `Third parties make ${Math.round((third.length / q.length) * 100)}% of requests and ${Math.round(
                total ? (thirdBytes / total) * 100 : 0,
              )}% of bytes`,
            }),
        },
        {
          label: 'Mixed content',
          value: mixed.length || (https ? 0 : undefined),
          ...(mixed.length > 0
            ? { tone: 'bad' as const, note: `${plural(mixed.length, 'request')} over plain HTTP from an HTTPS page` }
            : https && { tone: 'good' as const }),
          optional: !https,
        },
        {
          label: 'HTTP errors',
          value: errors.length || undefined,
          tone: 'warn',
          note: `${plural(errors.length, 'sub-request')} answered 4xx/5xx`,
          optional: true,
        },
        { label: 'Failed', value: failed.length || undefined, tone: 'info', optional: true },
        {
          label: 'Refused by policy',
          value: blocked.length
            ? `${blocked.length} (${[...new Set(blocked.map((b) => b.host))].slice(0, 4).join(', ')})`
            : undefined,
          tone: 'warn',
          note: `The page tried ${plural(blocked.length, 'connection')} the scanner refused (internal addresses or odd ports)`,
          optional: true,
        },
        {
          label: 'Budget',
          value: r.budget?.exceeded ? 'exceeded' : undefined,
          tone: 'warn',
          note: `The page went over the scan's budget (${bytes(r.budget?.bytes_limit)}, ${r.budget?.requests_limit} connections); the rest wasn't loaded`,
          optional: true,
        },
        {
          label: 'Console errors',
          value: r.console_errors.length || undefined,
          tone: 'info',
          optional: true,
        },
      ]
    }
    case 'libraries': {
      const libs = r.libraries ?? []
      if (!libs.length) return [{ label: 'Detected', value: 'none' }]
      return libs.map((lib) => {
        const risk = libraryRisk(lib)
        return {
          label: lib.name,
          value: lib.version ? `${lib.version} (${lib.source})` : `version unknown (${lib.source})`,
          ...(risk
            ? { tone: risk.tone, note: risk.note }
            : lib.version &&
              lib.source !== 'meta' && { tone: 'info' as const, note: `${lib.name} ${lib.version} is exposed` }),
        }
      })
    }
  }
}

export const SECTIONS: SectionId[] = [
  'document',
  'security',
  'metadata',
  'structure',
  'links',
  'images',
  'styles',
  'timing',
  'requests',
  'libraries',
]

export function sections(r: PageResult, now = Date.now()): Section[] {
  return SECTIONS.map((id) => ({ id, name: SECTION_NAMES[id], rows: visibleRows(summary(id, r, now)) }))
}

const ORDER: Record<string, number> = { bad: 0, warn: 1 }

/** The warn and bad rows of every section, worst first; a failed load is one finding. */
export function findings(r: PageResult, now = Date.now()): Finding[] {
  if (!r.ok) return [{ section: 'document', tone: 'bad', text: r.error?.message ?? "The page didn't load" }]
  const found: Finding[] = []
  for (const section of sections(r, now)) {
    for (const row of section.rows) {
      if (row.tone === 'warn' || row.tone === 'bad')
        found.push({ section: section.id, tone: row.tone, text: row.note ?? row.label })
    }
  }
  return found.sort((a, b) => (ORDER[a.tone] ?? 2) - (ORDER[b.tone] ?? 2))
}

export interface HostRow {
  host: string
  third_party: boolean
  requests: number
  bytes: number
  types: string
}

/** Requests grouped by host, heaviest first. */
export function hosts(requests: PageRequest[]): HostRow[] {
  const by = new Map<string, { third: boolean; n: number; bytes: number; types: Map<string, number> }>()
  for (const q of requests) {
    const key = q.host ?? '(none)'
    const entry = by.get(key) ?? { third: Boolean(q.third_party), n: 0, bytes: 0, types: new Map() }
    entry.n += 1
    entry.bytes += q.bytes ?? 0
    entry.types.set(q.type, (entry.types.get(q.type) ?? 0) + 1)
    by.set(key, entry)
  }
  return [...by.entries()]
    .map(([host, e]) => ({
      host,
      third_party: e.third,
      requests: e.n,
      bytes: e.bytes,
      types: [...e.types.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${t} ${n}`)
        .join(', '),
    }))
    .sort((a, b) => b.bytes - a.bytes || b.requests - a.requests)
}

/** Requests per resource type, most first. */
export function byType(requests: PageRequest[]): { type: string; requests: number; bytes: number }[] {
  const by = new Map<string, { requests: number; bytes: number }>()
  for (const q of requests) {
    const e = by.get(q.type) ?? { requests: 0, bytes: 0 }
    e.requests += 1
    e.bytes += q.bytes ?? 0
    by.set(q.type, e)
  }
  return [...by.entries()].map(([type, e]) => ({ type, ...e })).sort((a, b) => b.requests - a.requests)
}

/** The error kinds the service reports (contract "A run"), in words. */
export function describeFailure(error: PageResult['error']): string {
  if (!error) return "The page didn't load."
  const why: Record<string, string> = {
    dns: "The host didn't resolve when the browser asked.",
    network: "The browser couldn't connect, or the connection dropped.",
    timeout: 'The page took too long to load.',
    browser: 'The browser failed.',
    tls: 'The browser refused the TLS certificate.',
    policy_denied: 'The scanner refused to load it: it (or a redirect) points at an internal address or odd port.',
    budget: "The run's budget was spent before the page loaded.",
    redirects: 'Too many redirects.',
    not_a_page: 'The URL is a download, not a page.',
  }
  return `${why[error.kind] ?? `Failed (${error.kind}).`} ${error.message}`
}
