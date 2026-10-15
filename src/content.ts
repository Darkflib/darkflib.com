/** The SRE and systems demos page, a separate document from the home page. */
export const DEMOS_PATH = '/demos/'

/** Every project, on a page of its own; the home page shows the first FEATURED_PROJECTS. */
export const PROJECTS_PATH = '/projects/'
export const FEATURED_PROJECTS = 3

/** The top-level pages, each its own HTML document. */
export type SitePage = 'home' | 'projects' | 'demos'

// Root-relative, so the same links work from every page: on the home page they are fragment navigations.
export const nav = [
  { label: 'HOME', href: '/#home', page: 'home' },
  { label: 'ABOUT', href: '/#about' },
  { label: 'PROJECTS', href: PROJECTS_PATH, page: 'projects' },
  { label: 'POSTS', href: '/#posts' },
  { label: 'DEMOS', href: DEMOS_PATH, page: 'demos' },
  { label: 'CONTACT', href: '/#contact' },
] as const

export interface Project {
  slug: string
  name: string
  /** One line, shown on the card. */
  description: string
  /** A few sentences, shown in the dialog. */
  summary: string
  tags: readonly string[]
  /** Square screenshot under /images/projects, or null for a project with nothing public to show. */
  image: string | null
  links: { live?: string; source?: string }
}

export const projects: readonly Project[] = [
  {
    slug: 'orbit',
    name: 'ORBIT',
    description: 'Real-time satellite tracking in the browser',
    summary:
      'Tracks thirteen thousand satellites on a live globe: Starlink, GNSS, geostationary, and the rest, with re-entry and sky views. Runs entirely client-side from published orbital data.',
    tags: ['WEB', 'SPACE', 'OPEN SOURCE'],
    image: 'orbit',
    links: { live: 'https://darkflib.github.io/orbit/', source: 'https://github.com/Darkflib/orbit' },
  },
  {
    slug: 'orbit-data',
    name: 'ORBIT DATA',
    description: 'The data layer behind Orbit',
    summary:
      "Fetches CelesTrak's orbital elements within its usage policy, validates them, and publishes a static, cached copy with last-known-good fallback, so Orbit users add no load upstream. Scheduled updaters on Podman Quadlets.",
    tags: ['PYTHON', 'DATA', 'PODMAN'],
    image: 'orbit-data',
    links: { live: 'https://orbit-data.mikepreston.org/', source: 'https://github.com/Darkflib/orbit-data' },
  },
  {
    slug: 'radio-browser',
    name: 'RADIO BROWSER',
    description: 'Live internet radio on a 3D globe',
    summary:
      'Thousands of stations from radio-browser.info on an interactive vector globe, filtered down to healthy HTTPS streams and played straight in the browser. Vanilla JavaScript, no framework.',
    tags: ['WEB', 'AUDIO', 'VANILLA JS'],
    image: 'radio-browser',
    links: { live: 'https://darkflib.github.io/radio-browser/', source: 'https://github.com/Darkflib/radio-browser' },
  },
  {
    slug: 'sre-tab',
    name: 'SRE-TAB',
    description: 'Self-hosted developer news dashboard',
    summary:
      "Curated RSS and Atom feeds, and CISA's exploited-vulnerability catalogue, in one filtered stream, with topics, bookmarks, and read state kept on a server you run. Sign-in is GitHub OAuth against an allow-list, and nothing phones home. The KEV panel on this page is its feed, mirrored hourly.",
    tags: ['FASTAPI', 'REACT', 'SELF-HOSTED'],
    image: 'sre-tab',
    links: { live: 'https://sretab.mikepreston.org', source: 'https://github.com/Darkflib/sre-tab' },
  },
  {
    slug: 'idea-tab',
    name: 'IDEA-TAB',
    description: 'Writing prompts from a day of news',
    summary:
      "Turns a day of sre-tab's feed into ranked, sourced article ideas. Runs are append-only and replayable: the candidate set is an input, so a day can be re-synthesised with a different prompt and the two compared.",
    tags: ['PYTHON', 'LLM', 'POSTGRES'],
    image: null,
    links: {},
  },
]

export const projectNumber = (project: Project) => String(projects.indexOf(project) + 1).padStart(2, '0')

export const stack = [
  { mark: '⚛', name: 'React', color: 'cyan' },
  { mark: 'bolt', name: 'FastAPI', color: 'green' },
  { mark: 'TS', name: 'TypeScript', color: 'blue' },
  { mark: 'JS', name: 'Node.js', color: 'green' },
  { mark: '≈', name: 'Tailwind', color: 'cyan' },
  { mark: 'K8s', name: 'Kubernetes', color: 'blue' },
  { mark: 'Py', name: 'Python', color: 'yellow' },
  { mark: 'Pg', name: 'PostgreSQL', color: 'blue' },
] as const

// The newest posts come from this feed at build time (build/postsPlugin.ts); links go to the canonical copies there.
export const WRITING_URL = 'https://mikepreston.org/writing'
export const WRITING_FEED = 'https://mikepreston.org/rss.xml'
export const LATEST_POSTS = 6

// The contact form posts to mikepreston.org's API (form token, honeypot, behaviour score, rate limits, Mailgun)
// rather than exposing an address here. deploy/Caddyfile's CSP admits this origin for connect-src.
export const CONTACT_API = 'https://mikepreston.org/api/v1/contact'
export const CONTACT_PAGE_URL = 'https://mikepreston.org/contact'

export const TOOLS_URL = 'https://tools.mikepreston.org'

export const tools = [
  { slug: 'slo-calc', blurb: 'Error-budget and burn-rate calculator.' },
  { slug: 'nines-calc', blurb: 'Stack components in serial or parallel; see the combined nines.' },
  { slug: 'incident-timer', blurb: 'Full-screen incident clock with severity presets.' },
  { slug: 'jwt-peek', blurb: 'Decode JWTs without a server round-trip, ever.' },
  { slug: 'cidr-calc', blurb: 'IPv4/IPv6 subnet calculator.' },
  { slug: 'codename-gen', blurb: 'Cold War codenames for your next side project.' },
] as const
