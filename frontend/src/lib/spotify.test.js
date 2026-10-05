import { afterEach, describe, expect, it } from 'vitest'
import { spotifyAction } from './spotify.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('spotifyAction', () => {
  it.each([
    ['play', 'PUT'],
    ['pause', 'PUT'],
    ['next', 'POST'],
    ['previous', 'POST'],
  ])('uses %s with %s', async (action, method) => {
    let request
    globalThis.fetch = async (url, options) => {
      request = { url, options }
      return { status: 204 }
    }

    await spotifyAction(action, {
      accessToken: 'test-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })

    expect(request.url).toBe(`https://api.spotify.com/v1/me/player/${action}`)
    expect(request.options.method).toBe(method)
  })
})
