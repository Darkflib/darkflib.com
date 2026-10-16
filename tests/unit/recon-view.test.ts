// The domain recon page's summaries and findings, against payloads shaped like domaincheck's real output (schema 2.x,
// trimmed from live runs): dates live in RDAP's events, certificate expiry is computed from not_after.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  type CollectionResult,
  cipherRows,
  findings,
  headerChecks,
  minorFindings,
  normaliseDomain,
  type Row,
  summary,
  visibleRows,
  vulnerabilities,
} from '../../src/login/reconView.ts'

const NOW = Date.parse('2026-10-16T09:00:00Z')

const rdap = {
  status: ['client transfer prohibited'],
  nameservers: [{ ldh_name: 'NS1.VULTR.COM' }, { ldh_name: 'NS2.VULTR.COM' }],
  entities: [{ roles: ['registrar'], vcard: { fn: 'Namify Domains Inc' } }],
  events: [
    { action: 'registration', date: '2013-02-28T15:48:37Z' },
    { action: 'expiration', date: '2027-02-28T15:48:37Z' },
  ],
  secure_dns: { zone_signed: null, delegation_signed: false, ds_data: [] },
  data_source: 'rdap',
  whois43: null,
  age_days: 4978,
}

const dns = {
  authoritative_nameservers: ['ns1.vultr.com'],
  forward: {
    a: ['198.98.49.246'],
    aaaa: [],
    ns: ['ns1.vultr.com.', 'ns2.vultr.com.'],
    mx: [{ preference: 1, exchange: 'smtp.google.com.' }],
    txt_typed: [{ kind: 'spf' }, { kind: 'dmarc' }, { kind: 'spf' }],
  },
  nxdomain: false,
  dnssec: { ds_records: [], validated: false, failure_reason: 'no DS records at parent' },
  caa_tree: [{ zone: 'darkflib.com', records: [{ tag: 'issue' }] }],
  wildcard: { detected: true },
  lame_delegation: [],
  glue_mismatches: [],
}

const tls = {
  connection: { protocol: 'TLSv1.3', cipher_name: 'TLS_AES_256_GCM_SHA384' },
  leaf_certificate: {
    subject: { common_name: 'darkflib.com' },
    issuer: { common_name: 'YE1' },
    not_after: '2026-10-30T00:00:00Z',
    san_dns: ['darkflib.com', 'www.darkflib.com'],
    is_self_signed: false,
  },
  accepted_versions: ['TLSv1.2', 'TLSv1.3'],
  ocsp_stapled: false,
  sct_summary: { total: 2, known_logs: 0 },
  chain_validation: null,
}

const headers = {
  url: 'https://darkflib.com/',
  final_url: 'https://darkflib.com/',
  status_code: 200,
  http_version: 'HTTP/1.1',
  server: 'Caddy',
  redirect_chain: [],
  security: {
    hsts: { max_age: 31536000, include_subdomains: false, preload: false },
    csp: { raw: "default-src 'self'" },
  },
  cookies: [],
  hsts_preload: false,
  http_upgrade: { redirects_to_https: true },
}

const row = (rows: Row[], label: string) => {
  const found = rows.find((entry) => entry.label === label)
  assert.ok(found, `no ${label} row`)
  return found
}

const ok = (collector: CollectionResult['collector'], data: Record<string, unknown>): CollectionResult => ({
  collector,
  ok: true,
  duration_ms: 100,
  data,
  error: null,
})

describe('normaliseDomain', () => {
  it('keeps the host of a pasted URL', () => {
    assert.equal(normaliseDomain('  https://GitHub.com/foo/bar?x=1 '), 'github.com')
    assert.equal(normaliseDomain('http://user@example.com:8080/'), 'example.com')
  })
  it('strips a port, path, and trailing dot from a bare name', () => {
    assert.equal(normaliseDomain('example.com:443/path'), 'example.com')
    assert.equal(normaliseDomain('example.com.'), 'example.com')
  })
  it('leaves Unicode names and IPv6 literals for the service to judge', () => {
    assert.equal(normaliseDomain('müller.de'), 'müller.de')
    assert.equal(normaliseDomain('::1'), '::1')
  })
})

describe('summary', () => {
  it('reads registration dates from RDAP events', () => {
    const rows = summary('rdap', rdap, NOW)
    assert.equal(row(rows, 'Registered').value, '2013-02-28')
    assert.equal(row(rows, 'Expires').value, '2027-02-28 (in 135 days)')
    assert.equal(row(rows, 'Expires').tone, undefined)
    assert.equal(row(rows, 'Registrar').value, 'Namify Domains Inc')
    assert.equal(row(rows, 'Nameservers').value, 'ns1.vultr.com, ns2.vultr.com')
  })

  it('falls back to WHOIS fields where a registry has no RDAP', () => {
    const rows = summary(
      'rdap',
      {
        data_source: 'whois',
        events: [],
        whois43: { registrar: 'Nominet', registered_on: '2001-01-01T00:00:00Z', expires_on: '2026-11-01T00:00:00Z' },
      },
      NOW,
    )
    assert.equal(row(rows, 'Source').value, 'WHOIS (no RDAP)')
    assert.equal(row(rows, 'Registrar').value, 'Nominet')
    assert.equal(row(rows, 'Expires').tone, 'bad')
  })

  it('computes certificate expiry and warns inside 30 days', () => {
    const expires = row(summary('tls', tls, NOW), 'Expires')
    assert.equal(expires.value, '2026-10-30 (in 13 days)')
    assert.equal(expires.tone, 'bad')
    assert.equal(row(summary('tls', tls, NOW), 'Issuer').value, 'YE1')
  })

  it('uses the zone NS set, says why DNSSEC is absent, and hides empty optional rows', () => {
    const rows = summary('dns', dns, NOW)
    assert.equal(row(rows, 'Nameservers').value, 'ns1.vultr.com, ns2.vultr.com')
    assert.equal(row(rows, 'MX').value, '1 smtp.google.com')
    assert.equal(row(rows, 'TXT kinds').value, 'spf, dmarc')
    assert.equal(row(rows, 'DNSSEC').value, 'not signed')
    const shown = visibleRows(rows).map((entry) => entry.label)
    assert.ok(shown.includes('Wildcard'))
    assert.ok(!shown.includes('Lame delegations'))
    assert.ok(!shown.includes('Not queried (internal)'))
  })

  it('marks DNSSEC that is present but broken as bad', () => {
    const rows = summary(
      'dns',
      { ...dns, dnssec: { ds_records: [{}], validated: false, failure_reason: 'bogus' } },
      NOW,
    )
    assert.equal(row(rows, 'DNSSEC').tone, 'bad')
  })
})

describe('findings', () => {
  it('lists warn and bad rows worst first, and failed checks', () => {
    const found = findings(
      ['rdap', 'dns', 'tls', 'headers'],
      {
        rdap: ok('rdap', rdap),
        dns: ok('dns', dns),
        tls: ok('tls', tls),
        headers: {
          collector: 'headers',
          ok: false,
          duration_ms: 10_000,
          data: null,
          error: { kind: 'timeout', retryable: true, upstream: null, message: 'timed out' },
        },
      },
      NOW,
    )
    assert.deepEqual(found, [
      { check: 'tls', tone: 'bad', text: 'The certificate expires in 13 days' },
      { check: 'dns', tone: 'warn', text: 'Every subdomain resolves (wildcard record)' },
      { check: 'headers', tone: 'warn', text: 'Check failed: timed out' },
    ])
  })

  it('finds nothing in a healthy run', () => {
    assert.deepEqual(
      findings(
        ['dns', 'headers'],
        { dns: ok('dns', { ...dns, wildcard: { detected: false } }), headers: ok('headers', headers) },
        NOW,
      ),
      [],
    )
  })
})

// domaincheck schema 2.2: the TLS scan, certificate checks, and the assessments (trimmed from a live run of a legacy host).
const suite = (name: string, rating: string, issues: string[] = [], group = 'x25519') => ({
  name: `TLS_${name}`,
  rating,
  issues,
  key_exchange_group: group,
})

const scannedTls = {
  ...tls,
  leaf_certificate: { ...tls.leaf_certificate, not_after: '2027-01-30T00:00:00Z', key_type: 'RSA', key_bits: 2048 },
  accepted_versions: ['TLSv1', 'TLSv1.2', 'TLSv1.3'],
  chain_validation: { verified: false, trust_store: 'mozilla', reason: 'candidates exhausted' },
  certificate_checks: { hostname_matches: true, chain_complete: false, untrusted_root: null },
  scan: {
    complete: true,
    protocols: [
      {
        version: 'TLSv1.3',
        supported: true,
        server_preference: false,
        ciphers: [suite('AES_128_GCM_SHA256', 'strong')],
      },
      {
        version: 'TLSv1.2',
        supported: true,
        server_preference: false,
        ciphers: [
          suite('ECDHE_RSA_WITH_AES_128_GCM_SHA256', 'strong'),
          suite('RSA_WITH_3DES_EDE_CBC_SHA', 'weak', ['3des', 'no_forward_secrecy'], ''),
          suite('ECDHE_RSA_WITH_RC4_128_SHA', 'insecure', ['rc4']),
        ],
      },
      {
        version: 'TLSv1',
        supported: true,
        server_preference: false,
        ciphers: [suite('ECDHE_RSA_WITH_AES_128_CBC_SHA', 'acceptable', ['cbc'])],
      },
      { version: 'SSLv3', supported: false, ciphers: [] },
    ],
  },
  assessment: {
    findings: [
      { id: 'tls.cipher.rc4', severity: 'high', title: 'RC4 suites: 1' },
      { id: 'tls.chain.incomplete', severity: 'high', title: 'The chain is incomplete' },
      { id: 'tls.protocol.tlsv1', severity: 'medium', title: 'TLS 1.0 is accepted' },
      { id: 'tls.cipher.cbc', severity: 'low', title: 'TLS 1.2 still offers CBC suites: 1' },
      { id: 'tls.ocsp_stapling.missing', severity: 'info', title: 'No OCSP stapling' },
    ],
    vulnerabilities: [
      { id: 'rc4', name: 'RC4 biases', status: 'vulnerable', severity: 'high' },
      { id: 'beast', name: 'BEAST', status: 'vulnerable', severity: 'low' },
      { id: 'robot', name: 'ROBOT', status: 'not_tested', severity: 'high', detail: 'RSA key exchange is accepted' },
      { id: 'poodle', name: 'POODLE (SSLv3)', status: 'not_vulnerable', severity: 'high' },
    ],
  },
}

const gradedHeaders = {
  ...headers,
  assessment: {
    grade: 'D',
    score: 64,
    checks: [
      { id: 'hsts', name: 'Strict-Transport-Security', result: 'pass', detail: 'HSTS' },
      {
        id: 'csp',
        name: 'Content-Security-Policy',
        result: 'fail',
        detail: "CSP allows inline script ('unsafe-inline')",
      },
      { id: 'referrer_policy', name: 'Referrer-Policy', result: 'warn' },
      { id: 'coop', name: 'Cross-Origin-Opener-Policy', result: 'info' },
    ],
    software: [
      { header: 'server', product: 'Apache', version: '2.2.15', end_of_life: true },
      { header: 'x-powered-by', product: 'PHP', version: '8.3.1', end_of_life: false },
      { header: 'via', product: 'cloudflare', version: null, end_of_life: false },
    ],
    findings: [
      { id: 'http.end_of_life', severity: 'high', title: 'End-of-life software: Apache 2.2.15' },
      { id: 'http.csp_unsafe_inline', severity: 'medium', title: "CSP allows inline script ('unsafe-inline')" },
      {
        id: 'http.version_disclosure',
        severity: 'low',
        title: 'Software versions disclosed: Apache 2.2.15, PHP 8.3.1',
      },
    ],
  },
}

describe('TLS scan and certificate checks', () => {
  it('counts suites per version and colours the worst one', () => {
    const rows = summary('tls', scannedTls, NOW)
    const suites = row(rows, 'Cipher suites')
    assert.equal(suites.value, 'TLSv1.3: 1 · TLSv1.2: 3 (1 insecure, 1 weak) · TLSv1: 1')
    assert.equal(suites.tone, 'bad')
    assert.match(suites.note ?? '', /ECDHE_RSA_WITH_RC4_128_SHA/)
    assert.equal(row(rows, 'Server order').value, 'client picks')
  })

  it('names the weaknesses found, worst tone first', () => {
    const weaknesses = row(summary('tls', scannedTls, NOW), 'Weaknesses')
    assert.equal(weaknesses.value, 'RC4 biases, BEAST')
    assert.equal(weaknesses.tone, 'bad')
  })

  it('says why the chain fails and flags a host-name mismatch', () => {
    const rows = summary('tls', scannedTls, NOW)
    assert.equal(row(rows, 'Chain').value, 'not verified: incomplete (missing intermediate)')
    const mismatch = summary('tls', { ...scannedTls, certificate_checks: { hostname_matches: false } }, NOW)
    assert.equal(row(mismatch, 'Names').tone, 'bad')
    assert.equal(row(rows, 'Key').value, 'RSA 2048')
  })

  it('reads clean as good once a complete scan finds nothing', () => {
    const clean = {
      ...scannedTls,
      scan: { complete: true, protocols: [scannedTls.scan.protocols[0]] },
      assessment: { findings: [], vulnerabilities: [{ id: 'poodle', name: 'POODLE', status: 'not_vulnerable' }] },
    }
    const rows = summary('tls', clean, NOW)
    assert.equal(row(rows, 'Cipher suites').tone, 'good')
    assert.equal(row(rows, 'Weaknesses').value, 'none found')
    assert.equal(row(rows, 'Weaknesses').tone, 'good')
  })

  it('never reads an incomplete scan as clean', () => {
    const partial = {
      ...scannedTls,
      scan: { complete: false, protocols: [scannedTls.scan.protocols[0]] },
      assessment: { findings: [], vulnerabilities: [{ id: 'poodle', name: 'POODLE', status: 'unknown' }] },
    }
    const rows = summary('tls', partial, NOW)
    assert.equal(row(rows, 'Cipher suites').value, 'TLSv1.3: 1 (scan incomplete)')
    assert.equal(row(rows, 'Cipher suites').tone, 'info')
    assert.equal(row(rows, 'Weaknesses').value, 'none found so far')
    assert.equal(row(rows, 'Weaknesses').tone, 'info')
  })

  it('leaves the scan rows out for a result without a scan', () => {
    const shown = visibleRows(summary('tls', tls, NOW)).map((entry) => entry.label)
    assert.ok(!shown.includes('Cipher suites'))
    assert.ok(!shown.includes('Weaknesses'))
    assert.ok(!shown.includes('Server order'))
  })

  it('lists every accepted suite with its tone, and the weakness checks', () => {
    const suites = cipherRows(scannedTls)
    assert.equal(suites.length, 5)
    assert.deepEqual(
      suites.map((entry) => [entry.version, entry.name, entry.tone]),
      [
        ['TLSv1.3', 'AES_128_GCM_SHA256', 'good'],
        ['TLSv1.2', 'ECDHE_RSA_WITH_AES_128_GCM_SHA256', 'good'],
        ['TLSv1.2', 'RSA_WITH_3DES_EDE_CBC_SHA', 'warn'],
        ['TLSv1.2', 'ECDHE_RSA_WITH_RC4_128_SHA', 'bad'],
        ['TLSv1', 'ECDHE_RSA_WITH_AES_128_CBC_SHA', 'info'],
      ],
    )
    assert.deepEqual(
      vulnerabilities(scannedTls).map((entry) => [entry.id, entry.tone]),
      [
        ['rc4', 'bad'],
        ['beast', 'warn'],
        ['robot', 'info'],
        ['poodle', 'good'],
      ],
    )
    assert.deepEqual(minorFindings(scannedTls), ['TLS 1.2 still offers CBC suites: 1', 'No OCSP stapling'])
  })
})

describe('HTTP grade and software', () => {
  it('shows the grade and the versions the headers expose', () => {
    const rows = summary('headers', gradedHeaders, NOW)
    assert.equal(row(rows, 'Grade').value, 'D (64)')
    assert.equal(row(rows, 'Grade').tone, 'warn')
    assert.equal(row(rows, 'Versions exposed').value, 'Apache 2.2.15 (end of life), PHP 8.3.1')
    assert.equal(row(rows, 'Versions exposed').tone, 'bad')
    assert.equal(
      row(
        summary('headers', { ...gradedHeaders, assessment: { ...gradedHeaders.assessment, grade: 'A+' } }, NOW),
        'Grade',
      ).tone,
      'good',
    )
  })

  it('lists the best-practice checks with tones', () => {
    assert.deepEqual(
      headerChecks(gradedHeaders).map((entry) => [entry.name, entry.tone]),
      [
        ['Strict-Transport-Security', 'good'],
        ['Content-Security-Policy', 'bad'],
        ['Referrer-Policy', 'warn'],
        ['Cross-Origin-Opener-Policy', 'info'],
      ],
    )
  })
})

describe('findings with an assessment', () => {
  it("takes domaincheck's findings (medium and up) instead of the rows that say the same", () => {
    const found = findings(
      ['tls', 'headers'],
      { tls: ok('tls', scannedTls), headers: ok('headers', gradedHeaders) },
      NOW,
    )
    assert.deepEqual(found, [
      { check: 'tls', tone: 'bad', text: 'RC4 suites: 1' },
      { check: 'tls', tone: 'bad', text: 'The chain is incomplete' },
      { check: 'headers', tone: 'bad', text: 'End-of-life software: Apache 2.2.15' },
      { check: 'tls', tone: 'warn', text: 'TLS 1.0 is accepted' },
      { check: 'headers', tone: 'warn', text: 'HTTP best-practice grade D' },
      { check: 'headers', tone: 'warn', text: "CSP allows inline script ('unsafe-inline')" },
    ])
  })

  it('keeps row findings the assessment does not cover', () => {
    const found = findings(['headers'], { headers: ok('headers', { ...gradedHeaders, status_code: 503 }) }, NOW)
    assert.ok(found.some((entry) => entry.text === 'The site answers HTTP 503'))
  })
})
