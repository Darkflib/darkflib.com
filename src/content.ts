// Placeholder content carried over from the mockup. Replaced with real material in a later phase.

export const nav = [
  { label: 'HOME', href: '#home' },
  { label: 'ABOUT', href: '#about' },
  { label: 'PROJECTS', href: '#projects' },
  { label: 'SKILLS', href: '#skills' },
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
