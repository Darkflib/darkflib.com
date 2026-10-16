// Comparing two domain recon runs, and exporting one as a report: built only from reconView's rows and findings, so
// these use payloads shaped like domaincheck's (schema 2.x) and check the parts the page and the report rely on.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { compareRuns, jsonDiff, runLabel } from '../../src/login/reconCompare.ts'
import {
  certificateDiagram,
  chainSvg,
  delegationDiagram,
  esc,
  exportName,
  redirectDiagram,
  reportHtml,
} from '../../src/login/reconReport.ts'
import type { Run } from '../../src/login/reconRun.ts'
import type { CollectionResult } from '../../src/login/reconView.ts'

const NOW = Date.parse('2026-10-16T09:00:00Z')

const ok = (collector: CollectionResult['collector'], data: Record<string, unknown>): CollectionResult => ({
  collector,
  ok: true,
  duration_ms: 100,
  data,
  error: null,
})

const leaf = {
  subject: { common_name: 'example.com' },
  issuer: { common_name: 'R11' },
  serial_number: '01',
  not_after: '2027-01-10T00:00:00Z',
  san_dns: ['example.com'],
  key_type: 'EC',
  key_bits: 256,
  is_ca: false,
  is_self_signed: false,
}
const intermediate = {
  subject: { common_name: 'R11' },
  issuer: { common_name: 'ISRG Root X1' },
  serial_number: '02',
  not_after: '2027-03-12T00:00:00Z',
  key_type: 'RSA',
  key_bits: 2048,
  is_ca: true,
  is_self_signed: false,
}

const tls = {
  connection: { protocol: 'TLSv1.3', cipher_name: 'TLS_AES_128_GCM_SHA256' },
  leaf_certificate: leaf,
  chain: [leaf, intermediate],
  accepted_versions: ['TLSv1.2', 'TLSv1.3'],
  ocsp_stapled: false,
  chain_validation: { verified: true, trust_store: 'certifi', reason: null, verified_chain: [] },
}

const dns = {
  trace: [
    {
      query: 'example.com.',
      nameserver_ip: '198.41.0.4',
      nameserver_name: 'a.root-servers.net.',
      referral_to: ['a.gtld-servers.net.'],
      authoritative: false,
      rcode: 'NOERROR',
      duration_ms: 12,
    },
    {
      query: 'example.com.',
      nameserver_ip: '192.5.6.30',
      nameserver_name: 'a.gtld-servers.net.',
      referral_to: ['a.iana-servers.net.'],
      authoritative: false,
      rcode: 'NOERROR',
      duration_ms: 20,
    },
    {
      query: 'example.com.',
      nameserver_ip: '199.43.135.53',
      nameserver_name: 'a.iana-servers.net.',
      referral_to: [],
      authoritative: true,
      rcode: 'NOERROR',
      duration_ms: 31,
    },
  ],
  forward: { a: ['93.184.215.14', '93.184.215.15'], aaaa: [], ns: ['a.iana-servers.net.'] },
  nxdomain: false,
  dnssec: null,
  caa_tree: [],
}

const headers = {
  url: 'http://example.com/',
  final_url: 'https://www.example.com/',
  status_code: 200,
  redirect_chain: [
    { url: 'http://example.com/', status_code: 301, location: 'https://example.com/' },
    { url: 'https://example.com/', status_code: 308, location: 'https://www.example.com/' },
  ],
  security: { hsts: null, csp: null },
  cookies: [],
  http_upgrade: { redirects_to_https: true },
}

const run = (id: string, created: string, results: Run['results'], domain = 'example.com'): Run => ({
  id,
  domain,
  domain_unicode: domain,
  domain_a_label: domain,
  checks: Object.keys(results ?? {}) as Run['checks'],
  status: 'complete',
  created_at: created,
  completed_at: created,
  cost: 1,
  refunded: false,
  balance_after: 3,
  results,
})

const earlier = run('r1', '2026-10-01T09:00:00Z', {
  dns: ok('dns', dns),
  tls: ok('tls', tls),
  headers: ok('headers', headers),
})

describe('compareRuns', () => {
  it('says nothing changed between identical runs', () => {
    const diff = compareRuns(earlier, { ...earlier, id: 'r2' }, NOW)
    assert.equal(diff.changedRows, 0)
    assert.deepEqual(diff.findings.appeared, [])
    assert.deepEqual(diff.findings.cleared, [])
    assert.ok(diff.findings.kept.length > 0)
  })

  it('marks changed rows and the findings that appeared and cleared', () => {
    const later = run('r2', '2026-10-15T09:00:00Z', {
      dns: ok('dns', { ...dns, forward: { ...dns.forward, aaaa: ['2606:2800::1'] } }),
      tls: ok('tls', { ...tls, accepted_versions: ['TLSv1', 'TLSv1.2', 'TLSv1.3'] }),
      headers: ok('headers', { ...headers, security: { hsts: { max_age: 300 }, csp: null } }),
    })
    const diff = compareRuns(earlier, later, NOW)
    const dnsRows = diff.checks.find((check) => check.check === 'dns')?.rows ?? []
    const aaaa = dnsRows.find((row) => row.label === 'AAAA')
    assert.deepEqual([aaaa?.before, aaaa?.after, aaaa?.changed], ['', '2606:2800::1', true])
    assert.equal(dnsRows.find((row) => row.label === 'A')?.changed, false)
    assert.deepEqual(
      diff.findings.appeared.map((f) => f.text),
      ['Accepts legacy TLSv1'],
    )
    assert.deepEqual(
      diff.findings.cleared.map((f) => f.text),
      ['No Strict-Transport-Security header'],
    )
  })

  it('reads expiry with one clock, so a date that did not move is not a change', () => {
    const later = run('r2', '2026-10-15T09:00:00Z', earlier.results)
    const rows = compareRuns(earlier, later, NOW).checks.find((check) => check.check === 'tls')?.rows ?? []
    assert.equal(rows.find((row) => row.label === 'Expires')?.changed, false)
  })

  it('shows a check that only one run has, or that failed on one side, as an outcome change', () => {
    const later = run('r2', '2026-10-15T09:00:00Z', {
      dns: ok('dns', dns),
      tls: {
        collector: 'tls',
        ok: false,
        duration_ms: 1,
        data: null,
        error: { kind: 'timeout', retryable: true, upstream: null, message: 'timed out' },
      },
    })
    const diff = compareRuns(earlier, later, NOW)
    const tlsDiff = diff.checks.find((check) => check.check === 'tls')
    assert.deepEqual([tlsDiff?.before, tlsDiff?.after], ['ok', 'timeout'])
    assert.ok(tlsDiff?.rows.every((row) => !row.changed))
    assert.deepEqual(
      [
        diff.checks.find((check) => check.check === 'headers')?.before,
        diff.checks.find((check) => check.check === 'headers')?.after,
      ],
      ['ok', null],
    )
    assert.ok(diff.findings.appeared.some((f) => f.text === 'Check failed: timed out'))
  })

  it('compares two domains just the same', () => {
    const other = run('r3', '2026-10-15T09:00:00Z', earlier.results, 'example.net')
    assert.equal(compareRuns(earlier, other, NOW).changedRows, 0)
    assert.equal(runLabel(other), 'example.net · 2026-10-15 09:00 UTC')
  })
})

describe('jsonDiff', () => {
  it('compares lists of plain values as sets and leaves timings out', () => {
    const before = { dns: { duration_ms: 3, data: { a: ['1.1.1.1', '2.2.2.2'] } } }
    const after = { dns: { duration_ms: 9, data: { a: ['2.2.2.2', '1.1.1.1'] } } }
    assert.deepEqual(jsonDiff(before, after), [])
    assert.deepEqual(jsonDiff(before, { dns: { data: { a: ['2.2.2.2', '3.3.3.3'] } } }), [
      { path: 'dns.data.a[]', kind: 'removed', before: '1.1.1.1' },
      { path: 'dns.data.a[]', kind: 'added', after: '3.3.3.3' },
    ])
  })

  it('compares lists of objects by position, and reports added, removed and changed keys', () => {
    const diff = jsonDiff(
      { tls: { chain: [{ cn: 'a' }, { cn: 'b' }], gone: 1 } },
      { tls: { chain: [{ cn: 'a' }, { cn: 'c' }, { cn: 'd' }], fresh: true } },
    )
    assert.deepEqual(diff, [
      { path: 'tls.chain[1].cn', kind: 'changed', before: 'b', after: 'c' },
      { path: 'tls.chain[2]', kind: 'added', after: { cn: 'd' } },
      { path: 'tls.gone', kind: 'removed', before: 1 },
      { path: 'tls.fresh', kind: 'added', after: true },
    ])
  })
})

describe('report diagrams', () => {
  it('draws the delegation from the root to the authoritative servers', () => {
    const diagram = delegationDiagram(dns)
    assert.deepEqual(
      diagram?.nodes.map((node) => node.title),
      ['a.root-servers.net (198.41.0.4)', 'a.gtld-servers.net (192.5.6.30)', 'a.iana-servers.net (199.43.135.53)'],
    )
    assert.equal(diagram?.nodes[0].detail, 'asked example.com · refers to a.gtld-servers.net')
    assert.equal(diagram?.nodes[2].tone, 'good')
    assert.equal(diagram?.edges.length, 2)
  })

  it('draws the certificate chain once, leaf first, with who issued each', () => {
    const diagram = certificateDiagram(tls, NOW)
    assert.deepEqual(
      diagram?.nodes.map((node) => node.title),
      ['example.com', 'R11'],
    )
    assert.deepEqual(diagram?.edges, ['issued by R11'])
    assert.match(diagram?.note ?? '', /ISRG Root X1 is expected in the trust store\. The chain verifies\./)
    const expired = certificateDiagram({ ...tls, chain: [{ ...leaf, not_after: '2026-01-01T00:00:00Z' }] }, NOW)
    assert.equal(expired?.nodes[0].tone, 'bad')
  })

  it('draws each redirect and the final answer', () => {
    const diagram = redirectDiagram(headers)
    assert.deepEqual(
      diagram?.nodes.map((node) => `${node.title} ${node.detail}`),
      ['http://example.com/ HTTP 301', 'https://example.com/ HTTP 308', 'https://www.example.com/ HTTP 200 · final'],
    )
    assert.deepEqual(diagram?.edges, ['Location: https://example.com/', 'Location: https://www.example.com/'])
  })

  it('stops drawing a long chain and says so', () => {
    const long = { ...dns, trace: Array.from({ length: 20 }, () => dns.trace[0]) }
    const diagram = delegationDiagram(long)
    assert.equal(diagram?.nodes.length, 14)
    assert.match(diagram?.note ?? '', /6 more not drawn/)
  })

  it('escapes what hosts put in their answers', () => {
    const svg = chainSvg({ title: 'x', nodes: [{ title: '<script>alert(1)</script>' }, { title: 'b"' }], edges: ['&'] })
    assert.ok(!svg.includes('<script>'))
    assert.ok(svg.includes('&lt;script&gt;'))
    assert.ok(svg.includes('b&quot;'))
    assert.equal(esc(`<a href='x'>&`), '&lt;a href=&#39;x&#39;&gt;&amp;')
  })
})

describe('reportHtml', () => {
  const html = reportHtml(earlier, new Date(NOW))

  it('is one self-contained document that cannot fetch or run anything', () => {
    assert.match(html, /^<!doctype html>/)
    assert.match(
      html,
      /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'/,
    )
    assert.ok(!/<script|<link|<img|<iframe|\bsrc=|url\(/i.test(html))
    assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg|example\.com|www\.example\.com)/.test(html))
  })

  it('has the findings, every check, and its diagrams', () => {
    assert.match(html, /<h2>Findings<\/h2>/)
    assert.match(html, /No Strict-Transport-Security header/)
    for (const heading of ['DNS', 'TLS', 'HTTP']) assert.match(html, new RegExp(`<h2>${heading} <span class="ok">OK`))
    for (const figure of ['DNS delegation', 'Certificate chain', 'Redirects']) {
      assert.match(html, new RegExp(`<figure><h3>${figure}</h3><svg`))
    }
  })

  it('escapes a hostile value from the run', () => {
    const hostile = run('r9', '2026-10-01T09:00:00Z', {
      headers: ok('headers', { ...headers, server: '</style><script>alert(1)</script>' }),
    })
    const out = reportHtml(hostile, new Date(NOW))
    assert.ok(!out.includes('<script>'))
    assert.ok(out.includes('&lt;/style&gt;&lt;script&gt;'))
  })

  it('names exports by domain and time', () => {
    assert.equal(exportName(earlier, 'json'), 'recon-example.com-20261001-0900.json')
    assert.equal(
      exportName({ domain_a_label: 'xn--mller-kva.de', created_at: '2026-10-16T09:05:00Z' }, 'html'),
      'recon-xn--mller-kva.de-20261016-0905.html',
    )
  })
})
