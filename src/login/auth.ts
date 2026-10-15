// The browser side of wwff-auth's /auth API (github.com/Darkflib/wwff-auth, docs/contract.md). Same origin: Caddy
// proxies /auth/* to the service, and the session is an HttpOnly cookie this code never sees.

export type Provider = 'github' | 'google'
export type Tier = 'FEDERATED' | 'STANDARD' | 'HIGH'

export interface Assurance {
  auth_at: string
  age: number
}

export interface SessionState {
  user: { id: string; display_name: string | null; email: string | null }
  expires_at: string
  login_method: Provider | 'passkey'
  has_passkey: boolean
  identities: { id: string; provider: Provider; label: string }[]
  assurance: Record<Tier, Assurance | null>
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
  // A path on this origin only: "/x", never "//host" or "/\host", which browsers treat as another origin.
  return next && /^\/(?![/\\])/.test(next) ? next : '/tools/'
}

export function startUrl(provider: Provider, next: string): string {
  return `/auth/${provider}/start?${new URLSearchParams({ next })}`
}

async function request<T>(path: string, init?: { json: unknown }): Promise<T> {
  const response = await fetch(path, {
    method: init ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: init ? { 'Content-Type': 'application/json' } : undefined,
    body: init ? JSON.stringify(init.json) : undefined,
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

export const acceptInvite = (token: string) => request<void>('/auth/invite', { json: { token } })

export const logout = () => request<void>('/auth/logout', { json: {} })

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

/**
 * Enrol a passkey on the signed-in account. Throws an AuthError with `stepUp` set when the account already has
 * passkeys and none was used recently: call `stepUp` from a fresh click, then try again.
 */
export async function registerPasskey(nickname: string | null): Promise<void> {
  const issued = await request<Issued>('/auth/register/options', {
    json: nickname ? { nickname } : {},
  })
  const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(
    issued.options as PublicKeyCredentialCreationOptionsJSON,
  )
  const credential = credentialJson(await navigator.credentials.create({ publicKey }))
  await request('/auth/register/verify', { json: { challenge_id: issued.challenge_id, credential } })
}
