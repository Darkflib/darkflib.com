// The browser side of wwff-auth's /auth API (github.com/Darkflib/wwff-auth, docs/contract.md). Same origin: Caddy
// proxies /auth/* to the service, and the session is an HttpOnly cookie this code never sees.

export type Provider = 'github' | 'google'
export type Tier = 'FEDERATED' | 'STANDARD' | 'HIGH'

export interface Assurance {
  auth_at: string
  /** Seconds since `auth_at`, as the service saw it. */
  age: number
  /** STANDARD and HIGH only: the passkey that proved it. */
  credential_id?: string | null
  /** STANDARD and HIGH only: that passkey is still in its first-day cooldown, so cooldown-sensitive actions ignore it. */
  credential_in_cooldown?: boolean
}

export interface SessionState {
  user: { id: string; display_name: string | null; email: string | null }
  expires_at: string
  login_method: Provider | 'passkey'
  has_passkey: boolean
  identities: { id: string; provider: Provider; label: string }[]
  assurance: Record<Tier, Assurance | null>
  /** Granted roles, and those the session has proven the level for. Absent from a service without roles. */
  roles?: Roles
  /** Credit balances by type. Absent from a service without credits. */
  credits?: { balances: Record<string, number> }
}

export interface Roles {
  held: string[]
  active: string[]
}

/** One tool from GET /auth/tools: the user holds a role for it. */
export interface ToolAccess {
  slug: string
  /** The gate would let them in now. */
  active: boolean
  /** What would make it active: the easiest role they hold for it. */
  step_up: { tier: Tier; max_age: number } | null
}

/** A non-2xx answer, with the problem body's `reason` when it had one. */
export class AuthError extends Error {
  override name = 'AuthError'
  constructor(
    readonly status: number,
    readonly reason: string | null,
    /** The `step_up` member of a step-up 401. */
    readonly stepUp: { tier: Tier; max_age: number; reason: string } | null = null,
  ) {
    super(reason ?? `HTTP ${status}`)
  }
}

/** Where to go after signing in: a same-origin path from `?next=`, or the tools index. */
export function nextPath(search: string): string {
  const next = new URLSearchParams(search).get('next')
  if (!next?.startsWith('/')) return '/tools/'
  // Resolve it the way navigation will, rather than pattern-matching the text: the URL parser strips tabs and
  // newlines and reads "\" as "/", so "/\t/evil.com" and "/\evil.com" both become another origin.
  const origin = window.location.origin
  const url = new URL(next, origin)
  return url.origin === origin ? url.pathname + url.search + url.hash : '/tools/'
}

export function startUrl(provider: Provider, next: string): string {
  return `/auth/${provider}/start?${new URLSearchParams({ next })}`
}

/** Adds `provider` to the signed-in account; the service wants a passkey step-up within the last 5 minutes first. */
export function linkUrl(provider: Provider, next: string): string {
  return `/auth/${provider}/start?${new URLSearchParams({ link: '1', next })}`
}

async function request<T>(path: string, init?: { json?: unknown; method?: 'DELETE' | 'PUT' }): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? (init ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: init?.json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  })
  if (!response.ok) {
    let body: { reason?: unknown; step_up?: AuthError['stepUp'] } = {}
    try {
      body = await response.json()
    } catch {
      // Not a problem document: a proxy error page, or no service behind /auth yet.
    }
    throw new AuthError(
      response.status,
      typeof body.reason === 'string' ? body.reason : null,
      response.status === 401 && body.step_up ? body.step_up : null,
    )
  }
  return (response.status === 204 ? undefined : await response.json()) as T
}

/**
 * The signed-in session, or null only when the service says there is none (204). Anything else, a network error
 * or an unexpected status, throws: for callers that must not mistake a failed check for a signed-out session.
 */
export async function getSessionStrict(): Promise<SessionState | null> {
  return (await request<SessionState | undefined>('/auth/session')) ?? null
}

/** The signed-in session, or null when there is none (or no service answering). */
export async function getSession(): Promise<SessionState | null> {
  try {
    // 204 when signed out, rather than a 401 that every signed-out visit would log to the console.
    return (await request<SessionState | undefined>('/auth/session')) ?? null
  } catch (error) {
    if (error instanceof AuthError || error instanceof TypeError) return null
    throw error
  }
}

/** An enrolled passkey (GET /auth/credentials). */
export interface Passkey {
  id: string
  nickname: string
  tier: Exclude<Tier, 'FEDERATED'>
  /** Why it is not HIGH, e.g. "backup_eligible"; null when HIGH or not requested. */
  tier_reason: string | null
  created_at: string
  last_used_at: string | null
  synced: boolean
  in_cooldown: boolean
  cooldown_until: string | null
  flagged: boolean
}

export const listCredentials = () => request<Passkey[]>('/auth/credentials')

/**
 * The tools the user can see, and what each needs (GET /auth/tools). Null when the service predates roles (a 404),
 * so callers fall back to showing every tool, as the gate does then.
 */
export async function getTools(): Promise<{ roles: Roles; tools: ToolAccess[] } | null> {
  try {
    return await request<{ roles: Roles; tools: ToolAccess[] }>('/auth/tools')
  } catch (error) {
    if (error instanceof AuthError && error.status === 404) return null
    throw error
  }
}

/** The tool slug in a /tools/<slug>/… path, or null for anything else (including /tools/ itself). */
export function toolSlug(path: string): string | null {
  return /^\/tools\/([a-z0-9][a-z0-9-]{0,62})(?:\/|$)/.exec(path)?.[1] ?? null
}

export const acceptInvite = (token: string) => request<void>('/auth/invite', { json: { token } })

export const logout = () => request<void>('/auth/logout', { json: {} })

/**
 * Removes a GitHub or Google identity from the account: a passkey step-up within 5 minutes first, and never the
 * last way in (`reason: "last_way_in"`). Ends the session if it signed in with that identity.
 */
export const unlinkIdentity = (id: string) =>
  request<void>(`/auth/identities/${encodeURIComponent(id)}`, { method: 'DELETE' })

/** The browser has WebAuthn and the Level 3 JSON helpers this code relies on. */
export function passkeysSupported(): boolean {
  return (
    typeof PublicKeyCredential !== 'undefined' &&
    typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function' &&
    typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function'
  )
}

/** The visitor dismissed the browser's prompt, or it timed out: not worth an error message. */
export function isCancel(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')
}

interface Issued {
  challenge_id: string
  options: unknown
}

function credentialJson(credential: Credential | null): unknown {
  if (!(credential instanceof PublicKeyCredential)) throw new DOMException('No credential', 'NotAllowedError')
  return credential.toJSON()
}

async function assert(path: '/auth/login' | '/auth/step-up', body: object): Promise<unknown> {
  const issued = await request<Issued>(`${path}/options`, { json: body })
  const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(
    issued.options as PublicKeyCredentialRequestOptionsJSON,
  )
  const credential = credentialJson(await navigator.credentials.get({ publicKey }))
  return request(`${path}/verify`, { json: { challenge_id: issued.challenge_id, credential } })
}

/** Sign in with a discoverable passkey. */
export const loginWithPasskey = () => assert('/auth/login', {}) as Promise<SessionState>

/** Prove a passkey again, for an action that needs a fresh one. */
export const stepUp = (tier: Tier) => assert('/auth/step-up', { tier })

/** What POST /auth/register/verify reports about the new credential. */
export interface Registration {
  credential: Passkey
  tier: Exclude<Tier, 'FEDERATED'>
  /** Why a key enrolled as a hardware key was stored as STANDARD, e.g. "backup_eligible". */
  tier_reason: string | null
}

/** Why a key asked to be a hardware key (HIGH) was stored as STANDARD, in words someone can act on. */
export const TIER_REASONS: Record<string, string> = {
  backup_eligible:
    'It came from a passkey provider that syncs between devices (iCloud Keychain, 1Password, Google Password Manager), not from a hardware security key.',
  attestation_unverified: 'The key could not prove which model it is. Use a FIDO-certified security key.',
  mds_status_denied: 'That security key model has a known security problem.',
  aaguid_not_allowlisted: 'That security key model is not on the approved list.',
  mds_entry_missing: 'That security key model is not listed as trusted.',
}

/**
 * Enrol a passkey on the signed-in account; `hardware` asks for it to count as HIGH (tier_hint), which the service
 * grants only to a non-syncing, attested, MDS-listed security key. Throws an AuthError with `stepUp` set when the
 * account already has a key and none was used recently: call `stepUp` with that tier from a fresh click, then try
 * again.
 */
export async function registerPasskey(nickname: string | null, hardware = false): Promise<Registration> {
  const issued = await request<Issued>('/auth/register/options', {
    json: { ...(nickname ? { nickname } : {}), tier_hint: hardware ? 'HIGH' : 'STANDARD' },
  })
  const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(
    issued.options as PublicKeyCredentialCreationOptionsJSON,
  )
  const credential = credentialJson(await navigator.credentials.create({ publicKey }))
  return request<Registration>('/auth/register/verify', { json: { challenge_id: issued.challenge_id, credential } })
}

// The admin API (docs/contract.md, Administration): every call needs the `admin` role active, so any of them can
// answer with the step-up 401 once it lapses; callers catch AuthError.stepUp, step up from a fresh click, and retry.

export interface AdminUserSummary {
  id: string
  display_name: string | null
  email: string | null
  identities: { provider: Provider; label: string }[]
  roles: string[]
  created_at: string
  last_seen_at: string | null
}

export interface LedgerEntry {
  id: string
  type: string
  delta: number
  balance_after: number
  kind: 'grant' | 'spend' | 'refund'
  note: string | null
  /** "admin:<uuid>" or "tool:<slug>". */
  actor: string
  ref: string | null
  created_at: string
}

export interface AdminUser {
  id: string
  display_name: string | null
  email: string | null
  created_at: string
  last_seen_at: string | null
  identities: { provider: Provider; label: string; linked_at: string }[]
  roles: { held: string[]; web_grantable: string[] }
  passkeys: {
    nickname: string
    tier: Exclude<Tier, 'FEDERATED'>
    synced: boolean
    created_at: string
    last_used_at: string | null
  }[]
  credits: { balances: Record<string, number>; recent: LedgerEntry[] }
}

export const searchUsers = (q: string, cursor: string | null = null) =>
  request<{ users: AdminUserSummary[]; next: string | null }>(
    `/auth/admin/users?${new URLSearchParams({ q, limit: '25', ...(cursor ? { cursor } : {}) })}`,
  )

export const getAdminUser = (id: string) => request<AdminUser>(`/auth/admin/users/${encodeURIComponent(id)}`)

/** Grant or revoke a web_grantable role (never `admin`, which is granted only from the command line). */
export const setUserRole = (id: string, role: string, held: boolean) =>
  request<void>(`/auth/admin/users/${encodeURIComponent(id)}/roles/${encodeURIComponent(role)}`, {
    method: held ? 'PUT' : 'DELETE',
  })

/**
 * Add (positive) or remove (negative) credits; the balance never goes below zero (409 insufficient_credits). `ref`
 * makes it idempotent: the same ref again returns the first result and changes nothing, so a retry after a lost
 * response can't apply it twice.
 */
export const adjustCredits = (id: string, type: string, amount: number, note: string, ref: string) =>
  request<{ type: string; balance: number; entry: LedgerEntry }>(
    `/auth/admin/users/${encodeURIComponent(id)}/credits`,
    { json: { type, amount, note, ref } },
  )
