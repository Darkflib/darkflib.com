// The page recon page's summaries and findings, against a result shaped like wwff-pagerecon's (docs/contract.md, "A
// run"): what each section says, which rows deserve a look, and the findings drawn from them.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  byType,
  bytes,
  cspGaps,
  describeFailure,
  findings,
  framingProtection,
  header,
  hosts,
  libraryRisk,
  normaliseUrl,
  type PageRequest,
  type PageResult,
  parseCsp,
  type Row,
  type SectionId,
  sections,
  show,
  summary,
} from '../../src/login/pageView.ts'

const NOW = Date.parse('2026-10-16T09:00:00Z')

const req = (url: string, extra: Partial<PageRequest> = {}): PageRequest => ({
  url,
  method: 'GET',
  type: 'script',
  status: 200,
  mime: null,
  bytes: 1000,
  host: new URL(url).hostname,
  third_party: !new URL(url).hostname.endsWith('example.com'),
  failure: null,
  ms: 10,
  ...extra,
})

/** A well-kept page: everything present, nothing to flag. */
function clean(): PageResult {
  return {
    ok: true,
    error: null,
    duration_ms: 3000,
    final_url: 'https://www.example.com/',
    notes: [],
    document: {
      status: 200,
      url: 'https://www.example.com/',
      redirects: [],
      headers: [
        ['content-type', 'text/html; charset=utf-8'],
        ['strict-transport-security', 'max-age=31536000; includeSubDomains'],
        [
          'content-security-policy',
          "default-src 'self'; script-src 'self' 'nonce-abc'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        ],
        ['x-content-type-options', 'nosniff'],
        ['referrer-policy', 'strict-origin-when-cross-origin'],
        ['set-cookie', 'sid=1; Path=/; Secure; HttpOnly; SameSite=Lax'],
      ],
      remote: { ip: '93.184.215.14', port: 443 },
      tls: {
        protocol: 'TLS 1.3',
        issuer: 'R3',
        subject: 'www.example.com',
        valid_from: 0,
        valid_to: NOW / 1000 + 60 * 86400,
      },
    },
    screenshots: { viewport: { width: 1280, height: 800, bytes: 5, url: '/x' }, full_page: null },
    metadata: {
      title: 'Example: a well-kept page',
      lang: 'en',
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1',
      description: 'A page for the tests.',
      canonical: 'https://www.example.com/',
      robots: null,
      generator: null,
      theme_color: null,
      icons: [{ rel: 'icon', href: '/favicon.svg', sizes: null, type: 'image/svg+xml' }],
      meta: [],
      open_graph: { 'og:title': 'Example', 'og:image': 'https://www.example.com/og.png' },
      twitter: { 'twitter:card': 'summary_large_image' },
      json_ld: [{ types: ['Organization'], valid: true, data: {} }],
    },
    structure: {
      headings: [
        { level: 1, text: 'Example' },
        { level: 2, text: 'More' },
      ],
      landmarks: [
        { role: 'banner', label: null },
        { role: 'main', label: null },
      ],
      word_count: 400,
      forms: 0,
      iframes: [],
      scripts: { external: 1, inline: 0, module: 1, async_or_defer: 1 },
    },
    links: [
      {
        href: 'https://www.example.com/a',
        text: 'A',
        rel: [],
        target: null,
        scheme: 'https',
        internal: true,
        status: 200,
      },
      {
        href: 'https://other.org/',
        text: 'B',
        rel: ['noopener'],
        target: '_blank',
        scheme: 'https',
        internal: false,
        status: null,
      },
    ],
    styles: {
      stylesheets: [{ href: 'https://www.example.com/a.css', media: null, rules: 10 }],
      inline_style_blocks: 0,
      inline_style_attributes: 2,
      fonts: [],
    },
    images: [
      {
        src: 'https://www.example.com/a.webp',
        alt: 'A thing',
        has_alt: true,
        width: 600,
        height: 300,
        natural_width: 1200,
        natural_height: 600,
        loading: 'lazy',
        format: 'webp',
        bytes: 40_000,
      },
    ],
    timing: {
      ttfb_ms: 120,
      dom_interactive_ms: 300,
      dom_content_loaded_ms: 320,
      load_ms: 900,
      first_contentful_paint_ms: 500,
      largest_contentful_paint_ms: 900,
      cumulative_layout_shift: 0.01,
      transfer_bytes: 100_000,
      resource_count: 3,
    },
    requests: [
      req('https://www.example.com/', { type: 'document' }),
      req('https://static.example.com/app.js'),
      req('https://www.example.com/a.webp', { type: 'image', bytes: 40_000 }),
    ],
    blocked: [],
    libraries: [],
    csp: {
      header:
        "default-src 'self'; script-src 'self' 'nonce-abc'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      report_only: null,
      meta: [],
      violations: [],
    },
    console_errors: [],
    budget: { bytes: 50_000, bytes_limit: 26_214_400, requests: 3, requests_limit: 400, exceeded: false },
  }
}

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('fixture is missing a section')
  return value
}

const row = (rows: Row[], label: string) => rows.find((r) => r.label === label)
const rowsOf = (id: SectionId, r: PageResult) => sections(r, NOW).find((s) => s.id === id)?.rows ?? []

describe('normaliseUrl', () => {
  it('adds https and drops the fragment', () => {
    assert.equal(normaliseUrl(' example.com/pricing#plans '), 'https://example.com/pricing')
    assert.equal(normaliseUrl('example.com:8080/x'), 'https://example.com:8080/x')
    assert.equal(normaliseUrl('http://example.com/'), 'http://example.com/')
    assert.equal(normaliseUrl(''), '')
  })
  it('leaves other schemes for the service to refuse in words', () => {
    assert.equal(normaliseUrl('ftp://example.com/'), 'ftp://example.com/')
  })
})

describe('a well-kept page', () => {
  it('has no findings', () => {
    assert.deepEqual(findings(clean(), NOW), [])
  })
  it('marks the good things good', () => {
    const r = clean()
    assert.equal(row(rowsOf('document', r), 'Scheme')?.tone, 'good')
    assert.equal(row(rowsOf('security', r), 'CSP')?.tone, 'good')
    assert.equal(row(rowsOf('metadata', r), 'Open Graph')?.tone, 'good')
    assert.equal(row(rowsOf('timing', r), 'Largest contentful paint')?.tone, 'good')
    assert.equal(row(rowsOf('requests', r), 'Mixed content')?.value, 0)
  })
  it('leaves optional rows out when there is nothing to say', () => {
    const labels = rowsOf('security', clean()).map((r) => r.label)
    assert.ok(!labels.includes('X-Powered-By'))
    assert.ok(!labels.includes('Cookies without Secure'))
    assert.ok(labels.includes('HSTS'))
  })
})

describe('a neglected page', () => {
  function neglected(): PageResult {
    const r = clean()
    r.document = {
      ...must(r.document),
      status: 200,
      headers: [
        ['content-type', 'text/html'],
        ['server', 'Apache/2.4.29 (Ubuntu)'],
        ['x-powered-by', 'PHP/7.2.24'],
        ['set-cookie', 'PHPSESSID=x; path=/'],
      ],
      tls: { ...must(r.document).tls, valid_to: NOW / 1000 + 5 * 86400 },
    }
    r.csp = { header: null, report_only: null, meta: [], violations: [] }
    r.metadata = {
      ...must(r.metadata),
      description: null,
      lang: null,
      open_graph: {},
      twitter: {},
      json_ld: [{ types: [], valid: false, data: null }],
    }
    r.structure = { ...must(r.structure), headings: [{ level: 2, text: 'No h1' }], landmarks: [] }
    r.images = [{ ...must(must(r.images)[0]), has_alt: false, alt: null, format: 'jpeg', bytes: 900_000 }]
    r.links = [{ ...must(must(r.links)[0]), status: 404 }]
    r.libraries = [
      { name: 'jQuery', version: '1.12.4', source: 'global' },
      { name: 'React', version: '18.2.0', source: 'global' },
      { name: 'WordPress', version: '5.0', source: 'meta' },
    ]
    r.timing = { ...must(r.timing), largest_contentful_paint_ms: 6200, cumulative_layout_shift: 0.4 }
    r.requests = [
      req('https://www.example.com/', { type: 'document' }),
      req('http://cdn.example.net/a.js'),
      ...Array.from({ length: 18 }, (_, i) => req(`https://t${i}.tracker.io/p.js`)),
    ]
    r.blocked = [{ host: '169.254.169.254', port: 80, ip: '169.254.169.254', reason: 'denied_address' }]
    return r
  }

  it('flags each problem, worst first', () => {
    const found = findings(neglected(), NOW)
    const texts = found.map((f) => f.text)
    for (const expected of [
      'No Content-Security-Policy',
      'No Strict-Transport-Security header',
      'The Server header exposes a version (Apache/2.4.29 (Ubuntu))',
      'X-Powered-By exposes the stack (PHP/7.2.24)',
      'Cookies sent without Secure: PHPSESSID',
      'The certificate expires in 5 days',
      'No meta description',
      'No lang on <html>',
      'No Open Graph tags: links to it unfurl poorly',
      "1 JSON-LD block didn't parse",
      'No <h1>',
      'No main landmark',
      '1 image without alt text',
      '1 image over 500 KB',
      '1 broken internal link: https://www.example.com/a (404)',
      'jQuery 1.12.4 has known XSS flaws (fixed in 3.5.0)',
      '1 request over plain HTTP from an HTTPS page',
      '19 third-party hosts',
    ]) {
      assert.ok(texts.includes(expected), `missing finding: ${expected}\n${texts.join('\n')}`)
    }
    assert.ok(texts.some((t) => t.startsWith('Largest contentful paint is 6200 ms')))
    assert.ok(texts.some((t) => t.startsWith('Layout shift (CLS) is 0.400')))
    assert.ok(texts.some((t) => t.startsWith('Third parties make 95% of requests')))
    assert.ok(texts.some((t) => t.startsWith('The page tried 1 connection the scanner refused')))
    // Bad first, then warn.
    const tones = found.map((f) => f.tone)
    assert.deepEqual(
      tones,
      [...tones].sort((a, b) => (a === b ? 0 : a === 'bad' ? -1 : 1)),
    )
    assert.equal(found[0]?.tone, 'bad')
  })

  it('says an exposed library version without calling it a problem', () => {
    const libs = rowsOf('libraries', neglected())
    assert.equal(row(libs, 'React')?.tone, 'info')
    assert.equal(row(libs, 'React')?.note, 'React 18.2.0 is exposed')
    assert.equal(row(libs, 'WordPress')?.tone, undefined)
  })
})

describe('a page that did not load', () => {
  it('is one finding, and the failure in words', () => {
    const r: PageResult = {
      ...clean(),
      ok: false,
      error: { kind: 'policy_denied', retryable: false, message: 'inside.example: the network policy refused it' },
      document: null,
    }
    assert.deepEqual(findings(r, NOW), [
      { section: 'document', tone: 'bad', text: 'inside.example: the network policy refused it' },
    ])
    assert.match(describeFailure(r.error), /internal address/)
  })
})

describe('HSTS', () => {
  const withHsts = (value: string, url = 'https://www.example.com/') => {
    const r = clean()
    r.final_url = url
    r.document = { ...must(r.document), url, headers: [['strict-transport-security', value]] }
    return row(rowsOf('security', r), 'HSTS')
  }
  it('warns when max-age=0 turns it off on an HTTPS page', () => {
    assert.equal(withHsts('max-age=0')?.tone, 'warn')
    assert.equal(withHsts('max-age=0')?.note, 'HSTS max-age=0 turns HSTS off')
  })
  it('keeps a short max-age as information, and says nothing extra on HTTP', () => {
    assert.equal(withHsts('max-age=86400')?.tone, 'info')
    assert.equal(withHsts('max-age=31536000')?.tone, 'good')
    assert.notEqual(withHsts('max-age=0', 'http://www.example.com/')?.tone, 'warn')
  })
})

describe('CSP', () => {
  it('parses directives, first one wins', () => {
    const csp = parseCsp("default-src 'self'; script-src a b;script-src c; ;")
    assert.deepEqual(csp.get('script-src'), ['a', 'b'])
    assert.deepEqual(csp.get('default-src'), ["'self'"])
  })
  it('finds the gaps', () => {
    const texts = (policy: string) => cspGaps(policy).map((g) => g.text)
    assert.deepEqual(texts("default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"), [])
    assert.ok(
      texts("script-src 'self' 'unsafe-inline'").includes(
        "The CSP allows inline scripts ('unsafe-inline' with no nonce or hash)",
      ),
    )
    assert.ok(!texts("script-src 'self' 'unsafe-inline' 'nonce-x'").some((t) => t.includes('inline')))
    assert.ok(texts("script-src 'unsafe-eval' https:").includes("The CSP allows eval ('unsafe-eval')"))
    assert.ok(texts('script-src https:').includes('The CSP lets scripts load from anywhere (https:)'))
    assert.ok(texts('img-src *').includes('The CSP has no script-src or default-src, so scripts are unrestricted'))
  })
  it('counts only framing protection browsers enforce', () => {
    assert.equal(framingProtection("frame-ancestors 'none'", undefined), "frame-ancestors 'none'")
    assert.equal(
      framingProtection("frame-ancestors 'self' https://a.example", undefined),
      "frame-ancestors 'self' https://a.example",
    )
    assert.equal(framingProtection(null, 'DENY'), 'X-Frame-Options DENY')
    assert.equal(framingProtection(null, 'sameorigin'), 'X-Frame-Options SAMEORIGIN')
    // A wildcard or bare scheme in frame-ancestors lets anyone frame it; so does an invalid or conflicting XFO.
    for (const policy of [
      'frame-ancestors https:',
      'frame-ancestors *',
      'frame-ancestors https://*',
      "default-src 'self'",
    ])
      assert.equal(framingProtection(policy, undefined), null, policy)
    for (const xfo of ['ALLOWALL', 'ALLOW-FROM https://a.example', 'DENY, SAMEORIGIN', ''])
      assert.equal(framingProtection(null, xfo), null, xfo)
    assert.equal(framingProtection(null, 'DENY, deny'), 'X-Frame-Options DENY')
    // With frame-ancestors set, browsers ignore X-Frame-Options: an open one isn't rescued by DENY.
    assert.equal(framingProtection('frame-ancestors https:', 'DENY'), null)
  })
  it('ignores frame-ancestors from a meta tag', () => {
    const r = clean()
    r.csp = {
      header: null,
      report_only: null,
      meta: ["default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"],
      violations: [],
    }
    assert.ok(
      findings(r, NOW).some(
        (f) => f.text === 'Any site can frame the page (no effective frame-ancestors header or X-Frame-Options)',
      ),
    )
  })
  it('counts report-only as not enforced', () => {
    const r = clean()
    r.csp = { header: null, report_only: "default-src 'self'", meta: [], violations: [] }
    assert.equal(row(rowsOf('security', r), 'CSP')?.note, 'The CSP is report-only: nothing is enforced')
  })
  it('reads a meta-tag CSP', () => {
    const r = clean()
    r.csp = {
      header: null,
      report_only: null,
      meta: ["default-src 'self'; object-src 'none'; base-uri 'none'"],
      violations: [],
    }
    assert.equal(row(rowsOf('security', r), 'CSP')?.value, 'meta tag')
  })
})

describe('libraryRisk', () => {
  it('knows the long-settled cases', () => {
    assert.equal(libraryRisk({ name: 'jQuery', version: '3.4.1', source: 'url' })?.tone, 'bad')
    assert.equal(libraryRisk({ name: 'jQuery', version: '3.5.0', source: 'url' }), null)
    assert.equal(libraryRisk({ name: 'jQuery', version: null, source: 'global' }), null)
    assert.equal(libraryRisk({ name: 'AngularJS', version: '1.8.2', source: 'global' })?.tone, 'warn')
    assert.equal(libraryRisk({ name: 'Bootstrap', version: '3.4.1', source: 'url' })?.tone, 'warn')
    assert.equal(libraryRisk({ name: 'Bootstrap', version: '5.3.2', source: 'url' }), null)
  })
})

describe('tables', () => {
  const requests = [
    req('https://www.example.com/', { type: 'document', bytes: 100 }),
    req('https://cdn.other.net/a.js', { bytes: 5000 }),
    req('https://cdn.other.net/b.css', { type: 'stylesheet', bytes: 2000 }),
    req('https://www.example.com/x.png', { type: 'image', bytes: null }),
  ]
  it('groups by host, heaviest first', () => {
    assert.deepEqual(
      hosts(requests).map((h) => [h.host, h.third_party, h.requests, h.bytes]),
      [
        ['cdn.other.net', true, 2, 7000],
        ['www.example.com', false, 2, 100],
      ],
    )
  })
  it('counts by type', () => {
    assert.deepEqual(byType(requests)[0], { type: 'document', requests: 1, bytes: 100 })
  })
  it('reads headers and sizes', () => {
    assert.equal(
      header(
        [
          ['a', '1'],
          ['b', '2'],
          ['a', '3'],
        ],
        'a',
      ),
      '1, 3',
    )
    assert.equal(header([], 'a'), undefined)
    assert.equal(bytes(512), '512 B')
    assert.equal(bytes(2048), '2.0 KB')
    assert.equal(bytes(3 * 1024 * 1024), '3.0 MB')
    assert.equal(show(null), '—')
    assert.equal(show(true), 'yes')
  })
})

describe('the summary for an unloaded section', () => {
  it('is empty rather than throwing', () => {
    const r = clean()
    r.metadata = null
    r.structure = null
    r.styles = null
    r.timing = null
    assert.deepEqual(summary('metadata', r, NOW), [])
    assert.deepEqual(summary('structure', r, NOW), [])
    assert.ok(findings(r, NOW).length === 0)
  })
})
