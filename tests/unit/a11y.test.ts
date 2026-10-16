// The accessibility tool's colour maths (WCAG 2 contrast, suggestions, colour-vision simulation, APCA) and its reading
// of a page recon run's axe-core audit, against known values.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  apca,
  auditSummary,
  automatedLevel,
  contrast,
  criteria,
  grade,
  isLarge,
  luminance,
  over,
  pairOf,
  parseColour,
  parsePalette,
  type Rgb,
  showRatio,
  simulate,
  suggest,
  toHex,
} from '../../src/login/a11y.ts'
import { type Accessibility, type PageResult, summary } from '../../src/login/pageView.ts'

const c = (text: string) => {
  const colour = parseColour(text)
  assert.ok(colour, `${text} should parse`)
  return colour as Rgb
}

describe('parseColour', () => {
  it('reads hex in every length', () => {
    assert.deepEqual(c('#fff'), { r: 255, g: 255, b: 255, a: 1 })
    assert.deepEqual(c('0a0B0c'), { r: 10, g: 11, b: 12, a: 1 })
    assert.equal(c('#0008').a.toFixed(3), (0x88 / 255).toFixed(3))
    assert.equal(toHex(c('#11223380')), '#11223380')
  })

  it('reads rgb() and hsl() in both syntaxes', () => {
    assert.deepEqual(c('rgb(255, 0, 0)'), { r: 255, g: 0, b: 0, a: 1 })
    assert.deepEqual(c('rgb(0 128 255 / 50%)'), { r: 0, g: 128, b: 255, a: 0.5 })
    assert.equal(c('rgba(10,20,30,0.25)').a, 0.25)
    assert.equal(toHex(c('hsl(0, 100%, 50%)')), '#ff0000')
    assert.equal(toHex(c('hsl(120deg 100% 25%)')), '#008000')
  })

  it('refuses what it cannot read', () => {
    for (const bad of ['', 'red', '#12', 'rgb(1,2)', 'hsl(x, 1%, 1%)', 'url(x)'])
      assert.equal(parseColour(bad), undefined)
  })
})

describe('WCAG contrast', () => {
  it('matches the known ratios', () => {
    assert.equal(luminance(c('#fff')), 1)
    assert.equal(contrast(c('#000'), c('#fff')), 21)
    assert.equal(contrast(c('#fff'), c('#fff')), 1)
    assert.equal(showRatio(contrast(c('#767676'), c('#fff'))), '4.54:1')
    assert.equal(showRatio(contrast(c('#777777'), c('#fff'))), '4.47:1')
    assert.equal(showRatio(contrast(c('#ff0000'), c('#fff'))), '3.99:1')
  })

  it('truncates, never rounds up', () => {
    assert.equal(showRatio(4.4999), '4.49:1')
  })

  it('composites translucent colours before measuring', () => {
    // 50% black over white is #808080 (rounding aside).
    assert.equal(toHex(over(c('rgb(0 0 0 / 50%)'), c('#fff'))), '#808080')
    assert.equal(
      contrast(c('rgb(0 0 0 / 50%)'), c('#fff')),
      contrast({ r: 127.5, g: 127.5, b: 127.5, a: 1 }, c('#fff')),
    )
    // A transparent background is the white page under it.
    assert.equal(contrast(c('#000'), c('transparent')), 21)
  })

  it('grades and knows large text', () => {
    assert.deepEqual(grade(7.1), { label: 'AAA', tone: 'good' })
    assert.equal(grade(4.5).label, 'AA')
    assert.equal(grade(3.2).label, 'AA large')
    assert.equal(grade(2.9).label, 'fail')
    assert.ok(isLarge(24, 400) && isLarge(18.66, 700) && !isLarge(18.66, 400) && !isLarge(16, 700))
  })
})

describe('suggest', () => {
  it('finds the nearest passing text colour, darker first for light grey on white', () => {
    const [best] = suggest(c('#aaaaaa'), c('#ffffff'), 4.5)
    assert.equal(best.direction, 'darker')
    assert.ok(best.ratio >= 4.5 && best.ratio < 4.7, String(best.ratio))
    assert.ok(contrast(c(best.colour), c('#fff')) >= 4.5)
  })

  it('keeps the hue', () => {
    const [best] = suggest(c('#ff6666'), c('#ffffff'), 4.5)
    const out = c(best.colour)
    assert.ok(out.r > out.g && out.g === out.b, best.colour)
  })

  it('offers both directions when both can pass, and none that cannot', () => {
    const both = suggest(c('#777777'), c('#777777'), 3)
    assert.deepEqual(both.map((s) => s.direction).sort(), ['darker', 'lighter'])
    // Nothing on mid grey reaches 21:1.
    assert.deepEqual(suggest(c('#777777'), c('#777777'), 21), [])
  })

  it('can move the background instead', () => {
    const [best] = suggest(c('#ffffff'), c('#aaaaaa'), 4.5, 'bg')
    assert.ok(contrast(c('#ffffff'), c(best.colour)) >= 4.5)
  })
})

describe('colour vision', () => {
  it('leaves black and white alone, and greys red for achromatopsia', () => {
    for (const vision of ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'] as const) {
      assert.equal(toHex(simulate(c('#000'), vision)), '#000000')
      assert.equal(toHex(simulate(c('#fff'), vision)), '#ffffff')
    }
    const grey = simulate(c('#ff0000'), 'achromatopsia')
    assert.ok(Math.abs(grey.r - grey.g) < 1 && Math.abs(grey.g - grey.b) < 1)
  })

  it('makes red and green hard to tell apart for deuteranopia', () => {
    const red = simulate(c('#d62728'), 'deuteranopia')
    const green = simulate(c('#2ca02c'), 'deuteranopia')
    assert.ok(Math.abs(red.r - green.r) + Math.abs(red.g - green.g) < 120)
  })
})

describe('APCA', () => {
  it('gives the published values for black and white', () => {
    assert.equal(Math.round(apca(c('#000'), c('#fff'))), 106)
    assert.equal(Math.round(apca(c('#fff'), c('#000'))), -108)
    assert.equal(apca(c('#777'), c('#777')), 0)
  })
})

describe('parsePalette', () => {
  it('splits lines, commas outside parentheses, and space-separated hex', () => {
    const { colours, bad } = parsePalette('#fff, #000\nrgb(1, 2, 3)\n#111 #222 #333\nnope')
    assert.deepEqual(
      colours.map((entry) => entry.text),
      ['#fff', '#000', 'rgb(1, 2, 3)', '#111', '#222', '#333'],
    )
    assert.deepEqual(bad, ['nope'])
  })

  it('caps the grid', () => {
    const { colours, dropped } = parsePalette(
      Array.from({ length: 30 }, (_, i) => `#${String(i).padStart(6, '0')}`).join('\n'),
    )
    assert.equal(colours.length, 24)
    assert.equal(dropped, 6)
  })
})

const audit: Accessibility = {
  engine: { name: 'axe-core', version: '4.13.0' },
  standard: 'WCAG 2.2',
  violations: [
    {
      id: 'image-alt',
      impact: 'critical',
      tags: ['wcag2a', 'wcag111'],
      wcag: ['1.1.1'],
      level: 'A',
      best_practice: false,
      help: 'Images must have alternative text',
      description: null,
      help_url: null,
      nodes_total: 1,
      nodes: [],
    },
    {
      id: 'color-contrast',
      impact: 'serious',
      tags: ['wcag2aa', 'wcag143'],
      wcag: ['1.4.3'],
      level: 'AA',
      best_practice: false,
      help: 'Contrast',
      description: null,
      help_url: null,
      nodes_total: 2,
      nodes: [],
    },
  ],
  incomplete: [],
  passes: 18,
  inapplicable: 40,
  contrast: [
    {
      rule: 'color-contrast',
      fg: '#aaaaaa',
      bg: '#ffffff',
      ratio: 2.32,
      expected: 4.5,
      font_size: '12.0pt (16px)',
      font_weight: 'normal',
      example: 'Faint',
      target: 'p',
      count: 2,
    },
  ],
  counts: {
    violations: 2,
    nodes: 3,
    by_impact: { critical: 1, serious: 1, moderate: 0, minor: 0 },
    by_level: { A: 1, AA: 1, AAA: 0, 'best-practice': 0 },
  },
}

describe('the audit', () => {
  it('sums up and says what conformance is still possible', () => {
    assert.deepEqual(auditSummary(audit), {
      violations: 2,
      elements: 3,
      worst: 'critical',
      failingLevels: ['A', 'AA'],
      contrastPairs: 1,
      review: 0,
    })
    assert.equal(automatedLevel(audit), 'none')
    assert.equal(automatedLevel({ ...audit, counts: { ...audit.counts, by_level: { AA: 1 } } }), 'A')
    assert.equal(automatedLevel({ ...audit, counts: { ...audit.counts, by_level: {} } }), 'AAA')
  })

  it('names criteria, and loads a failing pair into the checker', () => {
    assert.equal(criteria(audit.violations[1]), '1.4.3 AA')
    assert.equal(criteria({ wcag: [], level: null, best_practice: true }), 'best practice')
    assert.deepEqual(pairOf(audit.contrast[0]), { fg: c('#aaaaaa'), bg: c('#ffffff') })
    assert.equal(pairOf({ fg: null, bg: '#fff' }), undefined)
  })

  it("is page recon's ACCESSIBILITY section, its severe rows findings", () => {
    const result = { ok: true, accessibility: audit } as unknown as PageResult
    const rows = Object.fromEntries(summary('accessibility', result).map((row) => [row.label, row]))
    assert.equal(rows.Violations.value, '2 rules, 3 elements')
    assert.equal(rows.Violations.tone, 'bad')
    assert.equal(rows['Text contrast (AA)'].value, '2 elements, 1 colour pair')
    assert.match(rows.Violations.note ?? '', /1 critical, 1 serious/)
    assert.equal(rows['Text contrast (AA)'].tone, 'warn')
    assert.equal(summary('accessibility', { ok: true } as PageResult)[0].value, 'not in this run (made before audits)')
  })
})
