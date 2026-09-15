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
    position: 'left',
  },
  {
    number: '02',
    name: 'ECHO',
    description: 'AI-powered creative tools',
    tags: ['AI', 'PRODUCT', 'WEB'],
    position: 'center',
  },
  {
    number: '03',
    name: 'HORIZON',
    description: 'A minimal theme for modern creators',
    tags: ['WEB', 'UI/UX', 'OPEN SOURCE'],
    position: 'right',
  },
] as const

export type Project = (typeof projects)[number]

export const stack = [
  { mark: '⚛', name: 'React', color: 'cyan' },
  { mark: 'N', name: 'Next.js', color: 'white' },
  { mark: 'TS', name: 'TypeScript', color: 'blue' },
  { mark: 'JS', name: 'Node.js', color: 'green' },
  { mark: '≈', name: 'Tailwind', color: 'cyan' },
  { mark: '●', name: 'Figma', color: 'pink' },
  { mark: 'Py', name: 'Python', color: 'yellow' },
  { mark: 'Pg', name: 'PostgreSQL', color: 'blue' },
] as const
