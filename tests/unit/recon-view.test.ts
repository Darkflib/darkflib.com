// The domain recon page's summaries and findings, against payloads shaped like domaincheck's real output (schema 2.x,
// trimmed from live runs): dates live in RDAP's events, certificate expiry is computed from not_after.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  type CollectionResult,
  findings,
  normaliseDomain,
  type Row,
  summary,
  visibleRows,
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
