// The domain recon page's summaries and findings, against payloads shaped like domaincheck's real output (schema 2.x,
// trimmed from live runs): dates live in RDAP's events, certificate expiry is computed from not_after.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  type CollectionResult,
  findings,
  nameserverMatrix,
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

// domaincheck v0.4's nameserver_comparison, trimmed from a live run (darkflib.com) and then given trouble: ns2 is a
// serial behind with an MX gone, ns3 times out, ns4 answers non-authoritatively, and IPv6 has no route from the checker.
const answers = (overrides: Record<string, string[]> = {}) => {
  const base: Record<string, string[]> = {
    NS: ['ns1.vultr.com', 'ns2.vultr.com'],
    A: ['198.98.49.246'],
    AAAA: [],
    MX: ['10 darkflib.com', '20 mx2.darkflib.com'],
    TXT: ['v=spf1 -all'],
    CAA: [],
    ...overrides,
  }
  return Object.fromEntries(
    Object.entries(base).map(([type, values]) => [
      type,
      { rcode: 'NOERROR', authoritative: true, values, error: null },
    ]),
  )
}
const soa = (serial: number) => ({
  mname: 'ns1.vultr.com',
  rname: 'dnsadm.choopa.com',
  serial,
  refresh: 10800,
  retry: 3600,
  expire: 604800,
  minimum: 3600,
})
const probe = (nameserver: string, ip: string, extra: Record<string, unknown>) => ({
  nameserver,
  ip,
  family: ip.includes(':') ? 6 : 4,
  sources: ['parent', 'zone'],
  address_source: 'glue',
  status: 'answered',
  error: null,
  rcode: 'NOERROR',
  authoritative: true,
  zone: 'darkflib.com',
  soa: soa(2026101601),
  answers: answers(),
  ...extra,
})
const comparison = {
  zone: 'darkflib.com',
  parent_ns: ['ns1.vultr.com', 'ns2.vultr.com', 'ns3.vultr.com'],
  zone_ns: ['ns1.vultr.com', 'ns2.vultr.com'],
  parent_only: ['ns3.vultr.com'],
  zone_only: [],
  servers: [
    probe('ns1.vultr.com', '173.199.96.96', {}),
    probe('ns1.vultr.com', '2001:19f0:ccc::1', {
      status: 'unreachable',
      error: 'NoRoute',
      rcode: null,
      authoritative: false,
      soa: null,
      answers: {},
    }),
    probe('ns2.vultr.com', '173.199.96.97', { soa: soa(2026101500), answers: answers({ MX: ['10 darkflib.com'] }) }),
    probe('ns3.vultr.com', '173.199.96.98', {
      status: 'timeout',
      error: 'Timeout',
      rcode: null,
      authoritative: false,
      soa: null,
      answers: {},
    }),
    probe('ns4.vultr.com', '173.199.96.99', { authoritative: false, answers: answers({ A: ['192.0.2.1'] }) }),
  ],
  serials: [2026101500, 2026101601],
  serial_drift: true,
  disagreements: [
    {
      record_type: 'MX',
      consensus: ['10 darkflib.com', '20 mx2.darkflib.com'],
      differing: [{ nameserver: 'ns2.vultr.com', ip: '173.199.96.97', missing: ['20 mx2.darkflib.com'], extra: [] }],
    },
  ],
  truncated: false,
}
const compared = { ...dns, wildcard: { detected: false }, nameserver_comparison: comparison }

describe('nameserver comparison', () => {
  it('summarises drift, unanswering addresses, and the NS sets', () => {
    const rows = summary('dns', compared, NOW)
    assert.equal(row(rows, 'Serial').value, '2026101500 ≠ 2026101601')
    assert.equal(row(rows, 'Serial').tone, 'warn')
    // The IPv6 address was never asked, so it isn't counted against the zone.
    assert.equal(row(rows, 'Nameservers answering').value, '2 of 4 addresses')
    assert.equal(row(rows, 'Nameservers answering').tone, 'bad')
    assert.equal(row(rows, 'IPv6 not checked').tone, 'info')
    assert.equal(row(rows, 'Record drift').value, 'MX')
    // The probes say lameness per address, so the per-name row stays out of the way.
    assert.ok(!visibleRows(rows).some((entry) => entry.label === 'Lame delegations'))
  })

  it('becomes findings, worst first', () => {
    assert.deepEqual(findings(['dns'], { dns: ok('dns', compared) }, NOW), [
      {
        check: 'dns',
        tone: 'bad',
        text:
          'Nameservers not answering for the zone: ns3.vultr.com 173.199.96.98: no answer (timeout); ' +
          'ns4.vultr.com 173.199.96.99: answered, but not authoritatively',
      },
      {
        check: 'dns',
        tone: 'warn',
        text: 'The nameservers serve different SOA serials (2026101500, 2026101601): one has not caught up',
      },
      {
        check: 'dns',
        tone: 'warn',
        text: 'The delegation and the zone list different nameservers: only the parent lists ns3.vultr.com',
      },
      {
        check: 'dns',
        tone: 'warn',
        text: 'The nameservers give different answers. MX: ns2.vultr.com 173.199.96.97 lacks 20 mx2.darkflib.com',
      },
    ])
  })

  it('finds nothing when every nameserver agrees', () => {
    const agreeing = {
      ...comparison,
      parent_only: [],
      servers: [comparison.servers[0], probe('ns2.vultr.com', '173.199.96.97', {})],
      serials: [2026101601],
      serial_drift: false,
      disagreements: [],
    }
    const data = { ...compared, nameserver_comparison: agreeing }
    assert.deepEqual(findings(['dns'], { dns: ok('dns', data) }, NOW), [])
    assert.equal(row(summary('dns', data, NOW), 'Serial').value, 2026101601)
    assert.equal(row(summary('dns', data, NOW), 'Nameservers answering').tone, 'good')
  })

  it('lays out a column per address and marks what differs from most', () => {
    const matrix = nameserverMatrix(compared)
    assert.ok(matrix)
    assert.deepEqual(
      matrix.columns.map((column) => [column.ip, column.status, column.tone, column.counted]),
      [
        ['173.199.96.96', 'ok', 'good', true],
        ['173.199.96.97', 'ok', 'good', true],
        ['173.199.96.98', 'no answer (timeout)', 'bad', false],
        ['173.199.96.99', 'answered, but not authoritatively', 'bad', false],
      ],
    )
    // Never asked, so a note rather than a column.
    assert.deepEqual(matrix.unrouted, ['ns1.vultr.com 2001:19f0:ccc::1'])
    const byLabel = Object.fromEntries(matrix.rows.map((entry) => [entry.label, entry]))
    assert.deepEqual(
      matrix.rows.map((entry) => entry.label),
      ['Serial', 'Primary', 'Contact', 'Timers', 'NS', 'A', 'AAAA', 'MX', 'TXT', 'CAA'],
    )
    // Two counted answers, one each: the first seen is the consensus, so ns2 is the odd one out.
    assert.deepEqual(
      byLabel.Serial.cells.map((cell) => cell && [cell.values[0], cell.differs]),
      [['2026101601', false], ['2026101500', true], null, ['2026101601', false]],
    )
    assert.equal(byLabel.MX.differs, true)
    assert.deepEqual(byLabel.MX.cells[1], {
      values: ['10 darkflib.com'],
      differs: true,
      extra: [],
      missing: ['20 mx2.darkflib.com'],
    })
    // ns4's A differs, but a non-authoritative answer doesn't count, so it isn't marked.
    assert.equal(byLabel.A.differs, false)
    assert.deepEqual(byLabel.A.cells[3], { values: ['192.0.2.1'], differs: false, extra: [], missing: [] })
    assert.deepEqual(byLabel.AAAA.cells[0], { values: [], differs: false, extra: [], missing: [] })
    assert.equal(byLabel.NS.differs, false)
  })

  it('marks a nameserver whose SOA differs only in its contact', () => {
    const other = probe('ns2.vultr.com', '173.199.96.97', {
      soa: { ...soa(2026101601), rname: 'hostmaster.vultr.com' },
    })
    const data = { ...compared, nameserver_comparison: { ...comparison, servers: [comparison.servers[0], other] } }
    const contact = nameserverMatrix(data)?.rows.find((entry) => entry.label === 'Contact')
    assert.equal(contact?.differs, true)
    assert.deepEqual(contact?.cells[1]?.extra, ['hostmaster.vultr.com'])
  })

  it('is absent for runs from before the comparison', () => {
    assert.equal(nameserverMatrix(dns), null)
    assert.ok(visibleRows(summary('dns', dns, NOW)).every((entry) => entry.label !== 'Serial'))
  })
})
