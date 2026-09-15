// Placeholder content carried over from the mockup. Replaced with real material in a later phase.

export const nav = [
  { label: 'HOME', href: '#home' },
  { label: 'ABOUT', href: '#about' },
  { label: 'PROJECTS', href: '#projects' },
  { label: 'POSTS', href: '#posts' },
  { label: 'CONTACT', href: '#contact' },
] as const

export const projects = [
  {
    number: '01',
    name: 'NEON DISTRICT',
    description: 'A visual storytelling experience',
    tags: ['WEB', 'CREATIVE', 'EXPERIMENTAL'],
    image: 'neon-district',
  },
  {
    number: '02',
    name: 'ECHO',
    description: 'AI-powered creative tools',
    tags: ['AI', 'PRODUCT', 'WEB'],
    image: 'echo',
  },
  {
    number: '03',
    name: 'HORIZON',
    description: 'A minimal theme for modern creators',
    tags: ['WEB', 'UI/UX', 'OPEN SOURCE'],
    image: 'horizon',
  },
] as const

export type Project = (typeof projects)[number]

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

// A selection from mikepreston.org, newest first, not the full archive; links go to the canonical copies there.
export const WRITING_URL = 'https://mikepreston.org/writing'

export const posts = [
  {
    slug: 'your-monitoring-stack-knows-too-much',
    title: 'Your Monitoring Stack Knows Too Much',
    subtitle: 'The largest, least-governed copy of your production data is sitting in your observability platform.',
    date: '2026-08-18',
  },
  {
    slug: 'stop-putting-secrets-in-env-vars',
    title: 'Stop Putting Secrets in Environment Variables',
    subtitle: 'Right up until it leaks through a child process, a crash dump, or a curious read of /proc.',
    date: '2026-07-31',
  },
  {
    slug: 'its-always-dns',
    title: "It's Always DNS: A Practical Debugging Guide for the Usual Suspect",
    subtitle: 'How to trace name resolution end to end and stop guessing.',
    date: '2026-07-24',
  },
  {
    slug: 'retries-should-have-a-budget-not-just-a-backoff',
    title: 'Retries Should Have a Budget—Not Just a Backoff',
    subtitle: "Backoff decides when you borrow capacity. A budget decides whether you're allowed to at all.",
    date: '2026-07-21',
  },
  {
    slug: 'prompt-injection-new-sql-injection',
    title: 'Prompt Injection Is the New SQL Injection: Securing Agentic Systems',
    subtitle: 'Trusted instructions and untrusted content in one context window, with no parameterised query.',
    date: '2026-07-10',
  },
  {
    slug: 'systemd-is-the-orchestrator-you-already-have',
    title: 'Systemd Is the Orchestrator You Already Have',
    subtitle: 'Dependency ordering, timers, sandboxing, socket activation: you are already paying for it.',
    date: '2026-06-18',
  },
] as const

export const TOOLS_URL = 'https://tools.mikepreston.org'

export const tools = [
  { slug: 'slo-calc', blurb: 'Error-budget and burn-rate calculator.' },
  { slug: 'nines-calc', blurb: 'Stack components in serial or parallel; see the combined nines.' },
  { slug: 'incident-timer', blurb: 'Full-screen incident clock with severity presets.' },
  { slug: 'jwt-peek', blurb: 'Decode JWTs without a server round-trip, ever.' },
  { slug: 'cidr-calc', blurb: 'IPv4/IPv6 subnet calculator.' },
  { slug: 'codename-gen', blurb: 'Cold War codenames for your next side project.' },
] as const
