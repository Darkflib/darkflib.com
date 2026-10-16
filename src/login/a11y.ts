// What /tools/a11y/ computes: colours parsed, WCAG 2 contrast and what each level asks of it, the nearest colour that
// passes, how a pair looks with each kind of colour-vision deficiency, APCA's lightness contrast, and the reading of a
// page recon run's accessibility audit (wwff-pagerecon docs/contract.md, `accessibility`). No DOM and no runtime
// imports, so the unit tests run it headless.

import type { Accessibility, AxeRule, ContrastPair } from './pageView'

/** sRGB, 0-255 per channel, and alpha 0-1. */
export interface Rgb {
  r: number
  g: number
  b: number
  a: number
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255]
}

export function rgbToHsl({ r, g, b }: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return [h * 60, s, l]
}

/** One rgb()/hsl() argument: a number or a percentage, of `full` (255 for channels, 1 for alpha and s/l). */
function part(text: string, full: number): number | undefined {
  const match = /^(-?\d*\.?\d+)(%?)$/.exec(text.trim())
  if (!match) return undefined
  const n = Number.parseFloat(match[1])
  return match[2] ? (n / 100) * full : n
}

/**
 * #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() and hsl()/hsla() in comma or space syntax, and `transparent`. Named
 * colours other than that are left to the page, which can ask the browser; undefined for anything else.
 */
export function parseColour(input: string): Rgb | undefined {
  const text = input.trim().toLowerCase()
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)
  if (hex) {
    const digits = hex[1].length <= 4 ? [...hex[1]].map((d) => d + d).join('') : hex[1]
    const n = (i: number) => Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16)
    return { r: n(0), g: n(1), b: n(2), a: digits.length === 8 ? n(3) / 255 : 1 }
  }
  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(text)
  if (!fn) return undefined
  const [colour, alphaText] = fn[2].split('/').map((piece) => piece.trim())
  const parts = colour.includes(',') ? colour.split(',').map((piece) => piece.trim()) : colour.split(/\s+/)
  const alphaPart = alphaText ?? (parts.length === 4 ? parts.pop() : undefined)
  if (parts.length !== 3) return undefined
  const a = alphaPart === undefined ? 1 : part(alphaPart, 1)
  if (a === undefined) return undefined
  if (fn[1].startsWith('rgb')) {
    const [r, g, b] = parts.map((piece) => part(piece, 255))
    if (r === undefined || g === undefined || b === undefined) return undefined
    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(a, 0, 1) }
  }
  const h = Number.parseFloat(parts[0].replace(/deg$/, ''))
  const s = part(parts[1], 1)
  const l = part(parts[2], 1)
  if (Number.isNaN(h) || s === undefined || l === undefined) return undefined
  const [r, g, b] = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1))
  return { r, g, b, a: clamp(a, 0, 1) }
}

const hex2 = (n: number) =>
  Math.round(clamp(n, 0, 255))
    .toString(16)
    .padStart(2, '0')

/** #rrggbb, or #rrggbbaa when it isn't opaque. */
export const toHex = ({ r, g, b, a }: Rgb) => `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ''}`

/** `top` drawn over `bottom` (straight alpha), opaque when `bottom` is. */
export function over(top: Rgb, bottom: Rgb): Rgb {
  const a = top.a + bottom.a * (1 - top.a)
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
  const mix = (t: number, u: number) => (t * top.a + u * bottom.a * (1 - top.a)) / a
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a }
}

const WHITE: Rgb = { r: 255, g: 255, b: 255, a: 1 }

const linear = (channel: number) => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG 2's relative luminance, of an opaque colour. */
export const luminance = ({ r, g, b }: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)

const ratioOf = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/** The pair as it renders: a translucent background over white (the page's own, as far as this tool knows), then the
 * text over that. */
export function resolvePair(fg: Rgb, bg: Rgb): { fg: Rgb; bg: Rgb } {
  const back = bg.a < 1 ? over(bg, WHITE) : bg
  return { fg: fg.a < 1 ? over(fg, back) : fg, bg: back }
}

/** WCAG 2 contrast ratio, 1 to 21, unrounded. */
export function contrast(fg: Rgb, bg: Rgb): number {
  const pair = resolvePair(fg, bg)
  return ratioOf(luminance(pair.fg), luminance(pair.bg))
}

/** As WCAG has it read: truncated, never rounded up (4.499 is not 4.5). */
export const showRatio = (ratio: number) => `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`

export interface Requirement {
  id: string
  level: 'AA' | 'AAA'
  criterion: string
  what: string
  min: number
}

/** WCAG 2.2's contrast criteria. Large text is at least 18pt (24px), or 14pt (18.66px) bold. */
export const REQUIREMENTS: Requirement[] = [
  { id: 'aa-normal', level: 'AA', criterion: '1.4.3', what: 'Text', min: 4.5 },
  { id: 'aa-large', level: 'AA', criterion: '1.4.3', what: 'Large text', min: 3 },
  { id: 'aa-ui', level: 'AA', criterion: '1.4.11', what: 'UI components and graphics', min: 3 },
  { id: 'aaa-normal', level: 'AAA', criterion: '1.4.6', what: 'Text', min: 7 },
  { id: 'aaa-large', level: 'AAA', criterion: '1.4.6', what: 'Large text', min: 4.5 },
]

export const passes = (ratio: number, min: number) => ratio >= min

/** The best level a ratio reaches, for a grid cell. */
export function grade(ratio: number): { label: string; tone: 'good' | 'info' | 'warn' | 'bad' } {
  if (ratio >= 7) return { label: 'AAA', tone: 'good' }
  if (ratio >= 4.5) return { label: 'AA', tone: 'good' }
  if (ratio >= 3) return { label: 'AA large', tone: 'warn' }
  return { label: 'fail', tone: 'bad' }
}

/** Is text of this size and weight "large" in WCAG's sense? `px` is CSS pixels. */
export const isLarge = (px: number, weight: number) => px >= 24 || (px >= 18.66 && weight >= 700)

export interface Suggestion {
  colour: string
  ratio: number
  /** darker or lighter than the colour it replaces. */
  direction: 'darker' | 'lighter'
  /** How far the HSL lightness moved, 0-1: the nearest is the least change. */
  shift: number
}

/**
 * The colours nearest `colour` (same hue and saturation, lightness moved) that reach `min` against `other`, darker
 * and lighter, nearest first. `which` says which of the pair moves; the other stays.
 */
export function suggest(fg: Rgb, bg: Rgb, min: number, which: 'fg' | 'bg' = 'fg'): Suggestion[] {
  const pair = resolvePair(fg, bg)
  const moving = which === 'fg' ? pair.fg : pair.bg
  const [h, s, l0] = rgbToHsl(moving)
  const at = (l: number): Rgb => {
    const [r, g, b] = hslToRgb(h, s, l)
    // Quantised as it will be written, so the ratio we report is the ratio the hex has.
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a: 1 }
  }
  // The ratio the pair would have with this candidate in place. A new background is measured with the original
  // text, since translucent text composites over whatever is under it and so moves with it.
  const score = (candidate: Rgb) => (which === 'fg' ? contrast(candidate, bg) : contrast(fg, candidate))
  const out: Suggestion[] = []
  for (const direction of ['darker', 'lighter'] as const) {
    const end = direction === 'darker' ? 0 : 1
    if (score(at(end)) < min) continue
    // Lightness moves luminance monotonically, and contrast with it, once past the other colour: bisect for the
    // smallest move that reaches `min`, then step until the rounded colour does.
    let near = l0
    let far = end
    for (let i = 0; i < 40; i++) {
      const mid = (near + far) / 2
      if (score(at(mid)) >= min) far = mid
      else near = mid
    }
    let l = far
    const step = direction === 'darker' ? -0.001 : 0.001
    while (score(at(l)) < min && l >= 0 && l <= 1) l += step
    const colour = at(clamp(l, 0, 1))
    const ratio = score(colour)
    if (ratio < min) continue
    out.push({ colour: toHex(colour), ratio, direction, shift: Math.abs(l - l0) })
  }
  return out.sort((a, b) => a.shift - b.shift)
}

export type Vision = 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia'

export const VISIONS: { id: Vision; name: string; blurb: string }[] = [
  { id: 'protanopia', name: 'Protanopia', blurb: 'no red cones (about 1% of men)' },
  { id: 'deuteranopia', name: 'Deuteranopia', blurb: 'no green cones (about 1% of men)' },
  { id: 'tritanopia', name: 'Tritanopia', blurb: 'no blue cones (rare)' },
  { id: 'achromatopsia', name: 'Achromatopsia', blurb: 'no colour at all (rare)' },
]

// Machado, Oliveira and Fernandes (2009), severity 1, on linear RGB.
const MATRICES: Record<Exclude<Vision, 'achromatopsia'>, number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
}

const encode = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

/** How an opaque colour looks to someone with that deficiency (an approximation, as every simulation is). */
export function simulate(colour: Rgb, vision: Vision): Rgb {
  const lin = [linear(colour.r), linear(colour.g), linear(colour.b)]
  if (vision === 'achromatopsia') {
    const y = encode(luminance(colour))
    return { r: y, g: y, b: y, a: colour.a }
  }
  const [r, g, b] = MATRICES[vision].map((row) => clamp(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2], 0, 1))
  return { r: encode(r), g: encode(g), b: encode(b), a: colour.a }
}

/**
 * APCA's lightness contrast (Lc, APCA-W3 0.0.98G-4g), the method proposed for WCAG 3: about ±106 for black on white,
 * negative for light text on dark. Informative only; WCAG 2's ratio is what conformance is measured with today.
 */
export function apca(fg: Rgb, bg: Rgb): number {
  const pair = resolvePair(fg, bg)
  const y = ({ r, g, b }: Rgb) => {
    const raw = 0.2126729 * (r / 255) ** 2.4 + 0.7151522 * (g / 255) ** 2.4 + 0.072175 * (b / 255) ** 2.4
    // biome-ignore lint/suspicious/noApproximativeNumericConstant: APCA's black clamp exponent is 1.414 exactly, not √2.
    return raw > 0.022 ? raw : raw + (0.022 - raw) ** 1.414
  }
  const text = y(pair.fg)
  const back = y(pair.bg)
  if (Math.abs(back - text) < 0.0005) return 0
  if (back > text) {
    const sapc = (back ** 0.56 - text ** 0.57) * 1.14
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100
  }
  const sapc = (back ** 0.65 - text ** 0.62) * 1.14
  return sapc > -0.1 ? 0 : (sapc + 0.027) * 100
}

/** Colours from a pasted list: one per line, or separated by commas outside parentheses, or by spaces between hex
 * values. What doesn't parse comes back as `bad`. */
export function parsePalette(input: string, resolve: (text: string) => Rgb | undefined = parseColour) {
  const pieces = input
    .split(/\n|,(?![^(]*\))|;/)
    .flatMap((piece) => (/^(\s*#?[0-9a-f]{3,8}\s+)+#?[0-9a-f]{3,8}\s*$/i.test(piece) ? piece.split(/\s+/) : [piece]))
    .map((piece) => piece.trim())
    .filter(Boolean)
  const colours: { text: string; colour: Rgb }[] = []
  const bad: string[] = []
  for (const text of pieces.slice(0, 24)) {
    const colour = resolve(text)
    if (colour) colours.push({ text, colour })
    else bad.push(text)
  }
  return { colours, bad, dropped: Math.max(0, pieces.length - 24) }
}

// ---------------------------------------------------------------------------------------------------------------------
// The audit: a page recon run's `accessibility` section.

export const IMPACT_TONE: Record<string, 'bad' | 'warn' | 'info'> = {
  critical: 'bad',
  serious: 'bad',
  moderate: 'warn',
  minor: 'info',
}

/** "1.4.3 AA", "4.1.2 A", or "best practice". */
export function criteria(rule: Pick<AxeRule, 'wcag' | 'level' | 'best_practice'>): string {
  if (!rule.wcag.length) return rule.level ? `WCAG ${rule.level}` : 'best practice'
  return `${rule.wcag.join(', ')}${rule.level ? ` ${rule.level}` : ''}`
}

/** The pair a contrast failure names, ready for the checker, or undefined when axe's colours don't parse. */
export function pairOf(pair: Pick<ContrastPair, 'fg' | 'bg'>): { fg: Rgb; bg: Rgb } | undefined {
  const fg = parseColour(pair.fg ?? '')
  const bg = parseColour(pair.bg ?? '')
  return fg && bg ? { fg, bg } : undefined
}

export interface AuditSummary {
  violations: number
  /** Contrast elements axe couldn't judge that were measured another way, and how many of them fail AA. */
  measured: number
  measuredFailures: number
  elements: number
  worst?: string
  failingLevels: string[]
  contrastPairs: number
  review: number
}

export function auditSummary(audit: Accessibility): AuditSummary {
  const levels = (['A', 'AA', 'AAA'] as const).filter((level) => (audit.counts.by_level[level] ?? 0) > 0)
  return {
    violations: audit.counts.violations,
    measured: (audit.contrast_review?.by_pseudo ?? 0) + (audit.contrast_review?.by_pixels ?? 0),
    measuredFailures: (audit.contrast_review?.failures ?? []).filter((failure) => failure.level === 'AA').length,
    elements: audit.counts.nodes,
    worst: (['critical', 'serious', 'moderate', 'minor'] as const).find(
      (impact) => (audit.counts.by_impact[impact] ?? 0) > 0,
    ),
    failingLevels: levels,
    contrastPairs: audit.contrast.length,
    review: audit.incomplete.length,
  }
}

/**
 * The conformance a page can still claim from what was automated (never more: much of WCAG needs a person): the
 * highest level with no violation at it or below it.
 */
export function automatedLevel(audit: Accessibility): 'AAA' | 'AA' | 'A' | 'none' {
  // Contrast measured from the rendering counts as much as axe's own verdicts.
  const measured = (level: 'AA' | 'AAA') =>
    (audit.contrast_review?.failures ?? []).some((failure) => failure.level === level)
  const at = (level: 'A' | 'AA' | 'AAA') =>
    (audit.counts.by_level[level] ?? 0) > 0 || (level !== 'A' && measured(level))
  if (at('A')) return 'none'
  if (at('AA')) return 'A'
  if (at('AAA')) return 'AA'
  return 'AAA'
}

/** axe's reasons for leaving contrast undecided (its message keys), in words. */
const REASONS: Record<string, string> = {
  bgImage: 'text over an image',
  bgGradient: 'text over a gradient',
  bgOverlap: 'another element overlaps the background',
  pseudoContent: 'a ::before/::after layer covers it',
  elmPartiallyObscured: 'partly covered by another element',
  elmPartiallyObscuring: 'it partly covers another element',
  shortTextContent: 'too little text to judge',
  nonBmp: 'only symbols or icon-font characters',
  nonTextContent: 'no real text',
  shadowOnText: 'a text shadow',
  equalRatio: 'text and background the same colour',
}

export const reason = (key: string) =>
  key.startsWith('not measured: ') ? `not measured (${key.slice('not measured: '.length)})` : (REASONS[key] ?? key)

/** Nodes of a rule that share a failure summary (axe's "Fix any of the following" text), so a reason repeated
 * across 150 elements is said once with the elements under it. Largest group first. */
export function groupNodes<T extends { summary: string | null }>(nodes: T[]): { summary: string | null; nodes: T[] }[] {
  const groups = new Map<string, { summary: string | null; nodes: T[] }>()
  for (const node of nodes) {
    const key = node.summary ?? ''
    const group = groups.get(key)
    if (group) group.nodes.push(node)
    else groups.set(key, { summary: node.summary, nodes: [node] })
  }
  return [...groups.values()].sort((a, b) => b.nodes.length - a.nodes.length)
}
