/**
 * The private tools this site has pages for, each at /tools/<slug>/ behind forward_auth (deploy/Caddyfile). Who may
 * open each one is not decided here: wwff-auth's access file lists each tool's roles, and GET /auth/tools says which of
 * these the signed-in user can see. A slug the access file doesn't list is refused at the gate.
 */
export interface Tool {
  slug: string
  name: string
  blurb: string
}

export const TOOLS: Tool[] = [
  {
    slug: 'debug',
    name: 'SESSION DEBUGGER',
    blurb: 'Your session, what a tool receives from the gate, your passkeys, and step-ups.',
  },
  {
    slug: 'users',
    name: 'USER ADMIN',
    blurb: 'Find users, set their roles, and add or remove credits.',
  },
  {
    slug: 'domain',
    name: 'DOMAIN RECON',
    blurb:
      'Registration, DNS, TLS, HTTP headers, and the certificates CT logs hold for a domain. One domain credit a run.',
  },
  {
    slug: 'page',
    name: 'PAGE RECON',
    blurb:
      'One URL in a headless browser: screenshot, metadata, links, images, timings, headers, and every request it makes. One page credit a run.',
  },
  {
    slug: 'a11y',
    name: 'ACCESSIBILITY',
    blurb:
      'WCAG contrast checker and palette grid, free in your browser; page audits with axe-core for one page credit.',
  },
]

/** The tool's display name, or its slug when this site has no entry for it. */
export const toolName = (slug: string) => TOOLS.find((tool) => tool.slug === slug)?.name ?? slug.toUpperCase()

/** How a level is proven, in words. */
export const LEVEL_PROOF = {
  FEDERATED: 'a GitHub or Google sign-in',
  STANDARD: 'a passkey',
  HIGH: 'a hardware key',
} as const
