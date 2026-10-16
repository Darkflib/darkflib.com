// A run as a document to keep: one self-contained HTML file (inline CSS and SVG, no script, no request of any kind,
// and a CSP of its own that forbids one) that reads well on screen and prints cleanly to PDF. Built from reconView's
// rows, its detail tables (through reconDetail) and findings, so it shows whatever the page shows, plus three
// diagrams: the DNS delegation, the certificate chain, and the redirect chain. No DOM, so the unit tests run it
// headless.

import { detailTables } from './reconDetail.ts'
import type { Run } from './reconRun.ts'
import { at, type Check, findings, show, summary, type Tone, visibleRows } from './reconView.ts'

const NAMES: Record<Check, string> = {
  rdap: 'Registration',
  dns: 'DNS',
  tls: 'TLS',
  headers: 'HTTP',
  ct: 'Certificate Transparency',
}

/** Everything that reaches the markup goes through here: every value in a run came from a host someone chose. */
export const esc = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

const COLOUR: Record<Tone | 'plain', { fill: string; stroke: string }> = {
  good: { fill: '#eaf6ee', stroke: '#2f7d4a' },
  info: { fill: '#eef3fa', stroke: '#4a6f9c' },
  warn: { fill: '#fdf4e3', stroke: '#a86a00' },
  bad: { fill: '#fbeaea', stroke: '#b02a2a' },
  plain: { fill: '#f5f6f8', stroke: '#5b6573' },
}

export interface Node {
  title: string
  detail?: string
  tone?: Tone
}

export interface Diagram {
  title: string
  nodes: Node[]
  /** The label on each arrow, between node i and node i + 1. */
  edges: string[]
  /** Said under the diagram, e.g. that it was cut short. */
  note?: string
}

const WIDTH = 640
const BOX = 48
const GAP = 30

/** Boxes top to bottom with labelled arrows between: every diagram here is a chain. Presentation attributes only. */
export function chainSvg(diagram: Diagram): string {
  const height = diagram.nodes.length * BOX + Math.max(0, diagram.nodes.length - 1) * GAP + 2
  const parts = diagram.nodes.map((node, i) => {
    const y = 1 + i * (BOX + GAP)
    const { fill, stroke } = COLOUR[node.tone ?? 'plain']
    const box =
      `<rect x="1" y="${y}" width="${WIDTH - 2}" height="${BOX}" rx="6" fill="${fill}" stroke="${stroke}"/>` +
      `<text x="14" y="${y + 20}" font-size="13" font-weight="600" fill="#1d232b">${esc(clip(node.title, 82))}</text>` +
      (node.detail
        ? `<text x="14" y="${y + 38}" font-size="11" fill="#4b5563">${esc(clip(node.detail, 100))}</text>`
        : '')
    if (i === diagram.nodes.length - 1) return box
    const from = y + BOX
    const arrow =
      `<line x1="40" y1="${from}" x2="40" y2="${from + GAP - 6}" stroke="#5b6573" stroke-width="1.5"/>` +
      `<path d="M34 ${from + GAP - 8} L40 ${from + GAP} L46 ${from + GAP - 8} Z" fill="#5b6573"/>` +
      `<text x="54" y="${from + GAP / 2 + 4}" font-size="11" fill="#4b5563">${esc(clip(diagram.edges[i] ?? '', 90))}</text>`
    return box + arrow
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(diagram.title)}" viewBox="0 0 ${WIDTH} ${height}" ` +
    `width="${WIDTH}" height="${height}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">` +
    `${parts.join('')}</svg>`
  )
}

const MAX_NODES = 14

const trimmed = (diagram: Diagram): Diagram =>
  diagram.nodes.length <= MAX_NODES
    ? diagram
    : {
        ...diagram,
        nodes: diagram.nodes.slice(0, MAX_NODES),
        edges: diagram.edges.slice(0, MAX_NODES - 1),
        note: `${diagram.nodes.length - MAX_NODES} more not drawn; they are in the run's JSON.`,
      }

const records = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]) : [])

/** The delegation trace, root to the zone's own servers: who was asked, and what they answered. */
export function delegationDiagram(data: Record<string, unknown>): Diagram | null {
  const hops = records(at(data, 'trace'))
  if (!hops.length) return null
  const nodes = hops.map((hop): Node => {
    const name = String(hop.nameserver_name ?? '').replace(/\.$/, '')
    const referral = Array.isArray(hop.referral_to) ? hop.referral_to.map((ns) => String(ns).replace(/\.$/, '')) : []
    const rcode = String(hop.rcode ?? 'NOERROR')
    return {
      title: `${name || '(unnamed)'} ${hop.nameserver_ip ? `(${hop.nameserver_ip})` : ''}`.trim(),
      detail: [
        `asked ${String(hop.query ?? '').replace(/\.$/, '') || '?'}`,
        hop.authoritative ? 'authoritative answer' : referral.length ? `refers to ${referral.join(', ')}` : null,
        rcode !== 'NOERROR' ? rcode : null,
      ]
        .filter(Boolean)
        .join(' · '),
      tone: rcode !== 'NOERROR' ? (rcode === 'NXDOMAIN' ? 'warn' : 'bad') : hop.authoritative ? 'good' : undefined,
    }
  })
  return trimmed({
    title: 'DNS delegation',
    nodes,
    edges: hops.slice(0, -1).map((hop) => (hop.authoritative ? 'then' : 'referral')),
  })
}

/** Leaf first, each certificate issued by the next; the end of the chain the server sent, root or not. */
export function certificateDiagram(data: Record<string, unknown>, now = Date.now()): Diagram | null {
  const leaf = at(data, 'leaf_certificate') as Record<string, unknown> | undefined
  const sent = records(at(data, 'chain'))
  // domaincheck's chain starts with the leaf; older payloads may not.
  const chain =
    leaf && sent[0]?.serial_number !== leaf.serial_number ? [leaf, ...sent] : sent.length ? sent : leaf ? [leaf] : []
  if (!chain.length) return null
  const nodes = chain.map((cert, i): Node => {
    const expires = Date.parse(String(cert.not_after ?? ''))
    const expired = !Number.isNaN(expires) && expires < now
    const key = [cert.key_type, cert.key_bits].filter(Boolean).join(' ')
    return {
      title: String(at(cert, 'subject.common_name') ?? at(cert, 'subject.organization.0') ?? '(no common name)'),
      detail: [
        i === 0 ? 'leaf' : cert.is_self_signed ? 'self-signed root' : cert.is_ca ? 'CA' : 'not a CA',
        Number.isNaN(expires)
          ? null
          : `${expired ? 'expired' : 'until'} ${new Date(expires).toISOString().slice(0, 10)}`,
        key || null,
        cert.signature_algorithm ? String(cert.signature_algorithm) : null,
      ]
        .filter(Boolean)
        .join(' · '),
      tone: expired || (i === 0 && cert.is_self_signed) ? 'bad' : undefined,
    }
  })
  const last = chain[chain.length - 1]
  const verified = at(data, 'chain_validation.verified')
  return trimmed({
    title: 'Certificate chain',
    nodes,
    edges: chain.slice(0, -1).map((cert) => `issued by ${String(at(cert, 'issuer.common_name') ?? '?')}`),
    note: [
      last && !last.is_self_signed && at(last, 'issuer.common_name')
        ? `The server's chain ends here; ${String(at(last, 'issuer.common_name'))} is expected in the trust store.`
        : null,
      verified === true
        ? 'The chain verifies.'
        : verified === false
          ? `The chain does not verify: ${String(at(data, 'chain_validation.reason') ?? 'no reason given')}.`
          : null,
    ]
      .filter(Boolean)
      .join(' '),
  })
}

/** Each response from the first URL to the one that answered. */
export function redirectDiagram(data: Record<string, unknown>): Diagram | null {
  const hops = records(at(data, 'redirect_chain'))
  const final = at(data, 'final_url') ?? at(data, 'url')
  if (!final && !hops.length) return null
  const status = at(data, 'status_code')
  const nodes: Node[] = [
    ...hops.map((hop): Node => ({ title: String(hop.url ?? '?'), detail: `HTTP ${hop.status_code ?? '?'}` })),
    {
      title: String(final ?? '?'),
      detail: `HTTP ${status ?? '?'}${hops.length ? ' · final' : ' · no redirects'}`,
      tone: typeof status === 'number' ? (status >= 400 ? 'warn' : 'good') : undefined,
    },
  ]
  return trimmed({
    title: 'Redirects',
    nodes,
    edges: hops.map((hop) => (hop.location ? `Location: ${hop.location}` : 'redirect')),
  })
}

export function diagrams(check: Check, data: Record<string, unknown>, now = Date.now()): Diagram[] {
  const found =
    check === 'dns'
      ? [delegationDiagram(data)]
      : check === 'tls'
        ? [certificateDiagram(data, now)]
        : check === 'headers'
          ? [redirectDiagram(data)]
          : []
  return found.filter((diagram): diagram is Diagram => diagram !== null)
}

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #1d232b; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 32px 20px 48px; }
h1 { margin: 0; font-size: 26px; }
h2 { margin: 32px 0 10px; padding-bottom: 4px; border-bottom: 2px solid #1d232b; font-size: 17px; letter-spacing: .04em; text-transform: uppercase; }
h3 { margin: 18px 0 8px; font-size: 13px; color: #4b5563; text-transform: uppercase; letter-spacing: .06em; }
.meta { margin: 6px 0 0; color: #4b5563; font-size: 12px; }
.mono, td, .meta { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { width: 32%; padding: 5px 8px; text-align: left; vertical-align: top; color: #4b5563; font-weight: 500; }
td { padding: 5px 8px; vertical-align: top; overflow-wrap: anywhere; }
tr + tr > * { border-top: 1px solid #e5e7eb; }
.tone-good { color: #2f7d4a; } .tone-info { color: #4a6f9c; } .tone-warn { color: #a86a00; font-weight: 600; } .tone-bad { color: #b02a2a; font-weight: 600; }
ul.findings { margin: 0; padding: 0; list-style: none; }
ul.findings li { margin: 0 0 6px; padding: 6px 10px; border-left: 4px solid; background: #f9fafb; }
ul.findings li.tone-warn { border-color: #a86a00; } ul.findings li.tone-bad { border-color: #b02a2a; }
.check { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; margin-right: 6px; }
.ok { color: #2f7d4a; } .failed { color: #b02a2a; }
figure { margin: 14px 0 0; break-inside: avoid; }
figure svg { max-width: 100%; height: auto; }
figcaption { margin-top: 4px; color: #4b5563; font-size: 11px; }
section { break-inside: auto; }
table, .findings li { break-inside: avoid; }
footer { margin-top: 40px; color: #6b7280; font-size: 11px; }
@page { margin: 16mm 14mm; }
@media print { main { max-width: none; padding: 0; } h2 { break-after: avoid; } }
`

const toneClass = (tone: Tone | undefined) => (tone ? ` class="tone-${tone}"` : '')

function checkSection(run: Run, check: Check, now: number): string {
  const result = run.results?.[check]
  const head = (state: string, cls: string) => `<h2>${esc(NAMES[check])} <span class="${cls}">${esc(state)}</span></h2>`
  if (!result) return `<section>${head('no result', 'failed')}</section>`
  if (!result.ok || !result.data) {
    return `<section>${head((result.error?.kind ?? 'failed').toUpperCase(), 'failed')}<p>${esc(result.error?.message ?? 'No data.')}${
      result.error?.retryable ? ' (a temporary failure on the other side)' : ''
    }</p></section>`
  }
  const rows = visibleRows(summary(check, result.data, now, run.results))
    .map(
      (row) =>
        `<tr><th scope="row">${esc(row.label)}</th><td${toneClass(row.tone)}${row.note ? ` title="${esc(row.note)}"` : ''}>${esc(show(row.value))}</td></tr>`,
    )
    .join('')
  const tables = detailTables(check, result.data)
    .map(
      (table) =>
        `<h3>${esc(table.title)}</h3><table>${table.rows
          .map(
            (row) =>
              `<tr><th scope="row">${esc(row.label)}</th><td${toneClass(row.tone)}>${esc(show(row.value))}</td></tr>`,
          )
          .join('')}</table>`,
    )
    .join('')
  const figures = diagrams(check, result.data, now)
    .map(
      (diagram) =>
        `<figure><h3>${esc(diagram.title)}</h3>${chainSvg(diagram)}${diagram.note ? `<figcaption>${esc(diagram.note)}</figcaption>` : ''}</figure>`,
    )
    .join('')
  return `<section>${head('OK', 'ok')}<table>${rows}</table>${tables}${figures}</section>`
}

/** The whole report. `now` is when it was made: relative dates ("in 30 days") are counted from the run itself. */
export function reportHtml(run: Run, generated = new Date()): string {
  const now = Date.parse(run.completed_at ?? run.created_at) || generated.getTime()
  const flagged = findings(run.checks, run.results, now)
  const title = `Domain recon: ${run.domain_unicode}`
  const findingsHtml = flagged.length
    ? `<ul class="findings">${flagged
        .map((f) => `<li class="tone-${f.tone}"><span class="check">${esc(NAMES[f.check])}</span>${esc(f.text)}</li>`)
        .join('')}</ul>`
    : '<p class="tone-good">Nothing stands out.</p>'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${esc(run.domain_unicode)}</h1>
<p class="meta">${run.domain_a_label !== run.domain_unicode ? `${esc(run.domain_a_label)} · ` : ''}run ${esc(run.id)}<br>
started ${esc(run.created_at)}${run.completed_at ? ` · finished ${esc(run.completed_at)}` : ''} · ${esc(run.status)}${run.refunded ? ' · refunded' : ''}<br>
checks: ${esc(run.checks.map((check) => NAMES[check]).join(', '))}</p>
<h2>Findings</h2>
${findingsHtml}
${run.checks.map((check) => checkSection(run, check, now)).join('\n')}
<footer>Report made ${esc(generated.toISOString())} by darkflib.com/tools/domain/, from the run's own data. Dates such as
"in 30 days" are counted from when the run finished. The full collected data is in the run's JSON export.</footer>
</main>
</body>
</html>
`
}

/** `recon-example.com-20261016-0900.json`: sorts by domain, then time. */
export function exportName(run: Pick<Run, 'domain_a_label' | 'created_at'>, extension: 'json' | 'html') {
  const stamp = run.created_at.slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
  return `recon-${run.domain_a_label.replace(/[^a-z0-9.-]/gi, '_')}-${stamp}.${extension}`
}
