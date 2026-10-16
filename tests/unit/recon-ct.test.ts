// Domain recon's Certificate Transparency check (wwff-recon's own `ct` collector): the summary, the CAA cross-check
// against the DNS check, and the tables, against payloads shaped like the service's (docs/contract.md, "Certificate
// Transparency").
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detailTables } from '../../src/login/reconDetail.ts'
import {
  type CollectionResult,
  caaConflicts,
  caaIdsFor,
  caaPolicy,
  ctCertificates,
  ctNames,
  findings,
  summary,
  visibleRows,
} from '../../src/login/reconView.ts'

const NOW = Date.parse('2026-10-16T09:00:00Z')

const cert = (over: Record<string, unknown>) => ({
  id: '1',
  serial: 'aa',
  issuer: "C=US, O=Let's Encrypt, CN=R11",
  issuer_name: "Let's Encrypt",
  common_name: 'example.com',
  names: ['example.com', 'www.example.com'],
  not_before: '2026-10-01T00:00:00Z',
  not_after: '2026-12-30T00:00:00Z',
  current: true,
  wildcard: false,
  url: 'https://crt.sh/?id=1',
  ...over,
})

const ct = {
  source: 'crt.sh',
  history: true,
  fallback_reason: null,
  total: 3,
  current: 2,
  expired: 1,
  first_issued: '2019-03-01T00:00:00Z',
  last_issued: '2026-10-01T00:00:00Z',
  certificates: [
    cert({}),
    cert({
      id: '2',
      serial: 'bb',
      issuer_name: 'DigiCert, Inc.',
      names: ['*.example.com'],
      wildcard: true,
      not_before: '2026-01-01T00:00:00Z',
      not_after: '2027-01-01T00:00:00Z',
      url: 'javascript:alert(1)',
    }),
    cert({
      id: '3',
      serial: 'cc',
      current: false,
      not_before: '2019-03-01T00:00:00Z',
      not_after: '2019-06-01T00:00:00Z',
    }),
  ],
  truncated: false,
  issuers: [
    {
      name: "Let's Encrypt",
      total: 2,
      current: 1,
      first_issued: '2019-03-01T00:00:00Z',
      last_issued: '2026-10-01T00:00:00Z',
    },
    {
      name: 'DigiCert, Inc.',
      total: 1,
      current: 1,
      first_issued: '2026-01-01T00:00:00Z',
      last_issued: '2026-01-01T00:00:00Z',
    },
  ],
  names: [
    { name: 'example.com', total: 2, current: 1, last_issued: '2026-10-01T00:00:00Z', wildcard: false },
    { name: '*.example.com', total: 1, current: 1, last_issued: '2026-01-01T00:00:00Z', wildcard: true },
    { name: 'old.example.com', total: 1, current: 0, last_issued: '2019-03-01T00:00:00Z', wildcard: false },
  ],
  names_truncated: false,
  other_names: 0,
}

const dnsWith = (records: { tag: string; value: string }[]) => ({
  caa_tree: [
    { zone: 'www.example.com', records: [] },
    { zone: 'example.com', records: records.map((record) => ({ flags: 0, ...record })) },
  ],
})

const result = (collector: 'ct' | 'dns', data: Record<string, unknown>): CollectionResult => ({
  collector,
  ok: true,
  duration_ms: 1,
  data,
  error: null,
})

const rows = (data: Record<string, unknown>, dns?: Record<string, unknown>) =>
  Object.fromEntries(
    visibleRows(summary('ct', data, NOW, dns ? { dns: result('dns', dns) } : undefined)).map((row) => [row.label, row]),
  )

describe('CT summary', () => {
  it('counts what the logs hold and who issued what is current', () => {
    const got = rows(ct)
    assert.equal(got.Source.value, 'crt.sh (every logged certificate)')
    assert.equal(got.Certificates.value, '3: 2 current, 1 expired')
    assert.equal(got['First logged'].value, '2019-03-01')
    assert.equal(got['Current issuers'].value, "Let's Encrypt (1), DigiCert, Inc. (1)")
    assert.equal(got['Issued in 30 days'].value, 1)
    assert.equal(got['Names covered'].value, '3 (2 current)')
    assert.equal(got.Wildcards.value, '1 current wildcard name')
    // No DNS check, so nothing to judge CAA against.
    assert.equal(got.CAA, undefined)
  })

  it('says when Cert Spotter stood in, with current certificates only', () => {
    const got = rows({ ...ct, source: 'certspotter', history: false, fallback_reason: 'crt.sh answered 502' })
    assert.equal(got.Source.tone, 'info')
    assert.match(got.Source.note ?? '', /502/)
    assert.equal(got.Certificates.value, '2 current')
    assert.equal(got['First logged'], undefined)
  })

  it('notes a name with no current certificate, without making it a finding', () => {
    const got = rows({ ...ct, current: 0, certificates: [], issuers: [], names: [] })
    assert.equal(got.Certificates.tone, 'info')
    assert.deepEqual(findings(['ct'], { ct: result('ct', { ...ct, current: 0 }) }, NOW), [])
  })
})

describe('CT against CAA', () => {
  it('reads the closest CAA set, issue and issuewild apart', () => {
    assert.deepEqual(
      caaPolicy(
        dnsWith([
          { tag: 'issue', value: 'letsencrypt.org' },
          { tag: 'issuewild', value: 'digicert.com; cansignhttpexchanges=yes' },
          { tag: 'iodef', value: 'mailto:x@example.com' },
        ]),
      ),
      { zone: 'example.com', issue: ['letsencrypt.org'], issuewild: ['digicert.com'] },
    )
    assert.equal(caaPolicy(dnsWith([{ tag: 'iodef', value: 'mailto:x@example.com' }])), undefined)
    assert.deepEqual(caaPolicy(dnsWith([{ tag: 'issue', value: ';' }]))?.issue, [])
  })

  it('maps the common issuers, and leaves unknown ones unjudged', () => {
    assert.deepEqual(caaIdsFor("Let's Encrypt"), ['letsencrypt.org'])
    assert.ok(caaIdsFor('Google Trust Services')?.includes('pki.goog'))
    assert.ok(caaIdsFor('ZeroSSL')?.includes('sectigo.com'))
    assert.equal(caaIdsFor('Some Private CA'), undefined)
  })

  it('flags a current certificate from an issuer CAA leaves out, as a finding', () => {
    const dns = dnsWith([{ tag: 'issue', value: 'letsencrypt.org' }])
    assert.deepEqual(caaConflicts(ct, dns), [{ issuer: 'DigiCert, Inc.', certificates: 1 }])
    const got = rows(ct, dns)
    assert.equal(got.CAA.tone, 'warn')
    assert.match(got.CAA.value as string, /DigiCert/)
    const found = findings(['dns', 'ct'], { dns: result('dns', dns), ct: result('ct', ct) }, NOW)
    assert.ok(found.some((entry) => entry.check === 'ct' && /CAA records at example.com/.test(entry.text)))
  })

  it('judges a wildcard by issuewild when there is one, and lets expired certificates be', () => {
    const dns = dnsWith([
      { tag: 'issue', value: 'letsencrypt.org' },
      { tag: 'issuewild', value: 'digicert.com' },
    ])
    assert.deepEqual(caaConflicts(ct, dns), [])
    assert.equal(rows(ct, dns).CAA.value, 'current issuers allowed (example.com)')
    assert.equal(rows(ct, dns).CAA.tone, 'good')
  })
})

describe('CT tables', () => {
  it('keeps only crt.sh links', () => {
    const certs = ctCertificates(ct)
    assert.equal(certs[0].url, 'https://crt.sh/?id=1')
    assert.equal(certs[1].url, undefined)
    assert.equal(new Set(certs.map((entry) => entry.key)).size, 3)
  })

  it('lists names current first, and gives the comparison issuers and names', () => {
    assert.deepEqual(
      ctNames(ct).map((name) => [name.name, name.current]),
      [
        ['example.com', 1],
        ['*.example.com', 1],
        ['old.example.com', 0],
      ],
    )
    const tables = detailTables('ct', ct)
    assert.deepEqual(
      tables.map((table) => table.title),
      ['Issuers', 'Names in the logs'],
    )
    assert.equal(tables[1].rows[2].value, 'none current · 1 logged')
  })
})
