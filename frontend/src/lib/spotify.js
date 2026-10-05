const SPOTIFY_AUTH_KEY = 'spotify_auth_v1'
const SPOTIFY_PENDING_KEY = 'spotify_auth_pending_v1'
const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || ''
const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state',
]

const nowSec = () => Math.floor(Date.now() / 1000)

function base64url(buf) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomString(size = 64) {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => (b % 36).toString(36)).join('')
}

async function challengeFromVerifier(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(digest)
}

function redirectUri() {
  return window.location.origin + '/settings'
}

function cleanAuth(a) {
  if (!a || !a.accessToken) return null
  return {
    accessToken: String(a.accessToken),
    refreshToken: a.refreshToken ? String(a.refreshToken) : '',
    tokenType: String(a.tokenType || 'Bearer'),
    expiresAt: Number(a.expiresAt || 0),
    scope: String(a.scope || ''),
  }
}

export function spotifyClientConfigured() {
  return !!SPOTIFY_CLIENT_ID
}

export function getSpotifyAuth() {
  try {
    return cleanAuth(JSON.parse(localStorage.getItem(SPOTIFY_AUTH_KEY) || 'null'))
  } catch {
    return null
  }
}

function saveSpotifyAuth(auth) {
  localStorage.setItem(SPOTIFY_AUTH_KEY, JSON.stringify(cleanAuth(auth)))
}

export function clearSpotifyAuth() {
  localStorage.removeItem(SPOTIFY_AUTH_KEY)
  sessionStorage.removeItem(SPOTIFY_PENDING_KEY)
}

export async function startSpotifyAuth() {
  if (!spotifyClientConfigured()) throw new Error('Missing VITE_SPOTIFY_CLIENT_ID')
  const verifier = randomString(96)
  const state = randomString(24)
  const challenge = await challengeFromVerifier(verifier)
  sessionStorage.setItem(SPOTIFY_PENDING_KEY, JSON.stringify({ verifier, state, at: Date.now() }))
  const q = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: SPOTIFY_SCOPES.join(' '),
  })
  window.location.assign('https://accounts.spotify.com/authorize?' + q.toString())
}

export async function completeSpotifyAuthIfPresent() {
  const u = new URL(window.location.href)
  const code = u.searchParams.get('code')
  const state = u.searchParams.get('state')
  const err = u.searchParams.get('error')
  if (!code && !err) return null

  // Remove callback params from URL regardless of outcome.
  ;['code', 'state', 'error'].forEach(k => u.searchParams.delete(k))
  history.replaceState({}, '', u.pathname + (u.search ? '?' + u.searchParams.toString() : '') + u.hash)

  if (err) throw new Error('Spotify auth rejected: ' + err)
  const pendingRaw = sessionStorage.getItem(SPOTIFY_PENDING_KEY)
  sessionStorage.removeItem(SPOTIFY_PENDING_KEY)
  if (!pendingRaw) throw new Error('Missing Spotify login state')

  let pending = null
  try { pending = JSON.parse(pendingRaw) } catch {}
  if (!pending?.verifier || !pending?.state || pending.state !== state) throw new Error('Spotify login state mismatch')

  const body = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: pending.verifier,
  })
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error_description || d.error || 'Could not exchange Spotify code')
  const auth = {
    accessToken: d.access_token,
    refreshToken: d.refresh_token || '',
    tokenType: d.token_type || 'Bearer',
    expiresAt: nowSec() + Number(d.expires_in || 3600),
    scope: d.scope || '',
  }
  saveSpotifyAuth(auth)
  return auth
}

async function refreshSpotifyAuth(auth) {
  if (!auth?.refreshToken) throw new Error('Spotify session expired. Connect again.')
  const body = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken,
  })
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error_description || d.error || 'Could not refresh Spotify session')
  const next = {
    accessToken: d.access_token,
    refreshToken: d.refresh_token || auth.refreshToken,
    tokenType: d.token_type || auth.tokenType || 'Bearer',
    expiresAt: nowSec() + Number(d.expires_in || 3600),
    scope: d.scope || auth.scope || '',
  }
  saveSpotifyAuth(next)
  return next
}

export async function spotifyToken(auth = getSpotifyAuth()) {
  if (!auth?.accessToken) throw new Error('Spotify is not connected')
  if ((auth.expiresAt || 0) - nowSec() > 30) return auth
  return refreshSpotifyAuth(auth)
}

export async function spotifyApi(path, opts = {}, auth) {
  let tok = await spotifyToken(auth)
  const run = async token => {
    const r = await fetch('https://api.spotify.com/v1' + path, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        Authorization: 'Bearer ' + token.accessToken,
        'Content-Type': 'application/json',
      },
    })
    if (r.status === 204) return null
    const d = await r.json().catch(() => ({}))
    if (!r.ok) {
      const e = new Error(d.error?.message || d.error_description || d.error || ('Spotify HTTP ' + r.status))
      e.status = r.status
      throw e
    }
    return d
  }
  try {
    return await run(tok)
  } catch (e) {
    if (e.status !== 401) throw e
    tok = await refreshSpotifyAuth(tok)
    return run(tok)
  }
}

export async function spotifyNowPlaying(auth) {
  return spotifyApi('/me/player/currently-playing?additional_types=track', { method: 'GET' }, auth)
}

export async function spotifyAction(action, auth) {
  const method = action === 'play' || action === 'pause' ? 'PUT' : 'POST'
  await spotifyApi('/me/player/' + action, { method }, auth)
}

export function spotifyOpenYouTubeMusic() {
  window.open('https://music.youtube.com', '_blank', 'noopener')
}
