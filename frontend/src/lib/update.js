// Update check — compares the installed version (__APP_VERSION__) against
// the latest release of this branded repository and optionally installs its APK.
//
// GitHub's public releases API needs no token.
// On Android (Capacitor), the APK asset is downloaded to the cache directory
// and handed to the system installer via a content:// URI.

import { MOBILE } from './mobile.js'

const GITHUB_REPO = 'jawelin08/tracketgym'
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
export const LATEST_RELEASE_PAGE_URL = `https://github.com/${GITHUB_REPO}/releases/latest`

/**
 * Compares two semver strings (e.g. "1.2.11" vs "1.3.0").
 * Returns  1 if a > b, -1 if a < b, 0 if equal.
 */
function compareSemver(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff > 0) return 1
    if (diff < 0) return -1
  }
  return 0
}

/**
 * Checks this repository's latest GitHub release.
 * Returns { hasUpdate, latestVersion, apkUrl, hashUrl, iosUrl } or throws on network failure.
 *   - hasUpdate: true if the latest release tag is newer than the running build
 *   - latestVersion: the semver string of the latest release (without "v" prefix)
 *   - apkUrl: direct download URL of the first .apk asset, or null
 *   - hashUrl: direct download URL of the .apk.sha256 hash file, or null
 */
// One request per app session: Settings is opened often, GitHub does not need to hear
// about it every time. The promise is cached, a failure is not.
let cached = null
export function resetUpdateCheck() { cached = null }
export async function checkForUpdate() {
  if (!cached) cached = fetchLatest().catch(e => { cached = null; throw e })
  return cached
}

// Web Settings exposes only branded binaries uploaded to this repository's releases.
export async function checkForDownloads() {
  const release = await checkForUpdate()
  return {
    releaseAvailable: release.releaseAvailable,
    apkUrl: release.apkUrl,
    latestVersion: release.latestVersion,
    iosUrl: release.iosUrl,
    iosVersion: release.iosUrl ? release.latestVersion : null,
    iosError: null,
  }
}

async function fetchLatest() {
  const res = await fetch(RELEASES_URL)
  if (res.status === 404) {
    return { releaseAvailable: false, hasUpdate: false, latestVersion: __APP_VERSION__, apkUrl: null, hashUrl: null, iosUrl: null }
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  const response = await res.json()
  const latest = Array.isArray(response) ? response[0] : response
  if (!latest) {
    return { releaseAvailable: false, hasUpdate: false, latestVersion: __APP_VERSION__, apkUrl: null, hashUrl: null, iosUrl: null }
  }
  if (Array.isArray(latest) || !latest.tag_name) {
    throw new Error('GitHub returned an invalid release response')
  }

  const latestVersion = latest.tag_name.replace(/^v/, '')
  const hasUpdate = compareSemver(latestVersion, __APP_VERSION__) > 0

  // GitHub release assets use browser_download_url. Keep the legacy GitLab
  // shape readable for packages created before this fork had its own releases.
  const assets = Array.isArray(latest.assets) ? latest.assets
    : Array.isArray(latest.assets?.links)
      ? latest.assets.links.map(link => ({ name: link.name, browser_download_url: link.direct_asset_url || link.url }))
      : []
  const assetUrl = asset => asset.browser_download_url || ''
  const hasFile = (asset, extension) => {
    const pattern = new RegExp(`\\.${extension}(?:$|[?#])`, 'i')
    return pattern.test(asset.name || '') || pattern.test(assetUrl(asset))
  }
  const apk = assets.find(asset => hasFile(asset, 'apk'))
  const checksum = assets.find(asset => hasFile(asset, 'apk\\.sha256') || /sha256/i.test(asset.name || ''))
  const ios = assets.find(asset => hasFile(asset, 'ipa'))
  return {
    releaseAvailable: true,
    hasUpdate,
    latestVersion,
    apkUrl: apk ? assetUrl(apk) || null : null,
    hashUrl: checksum ? assetUrl(checksum) || null : null,
    iosUrl: ios ? assetUrl(ios) || null : null,
  }
}

/**
 * Computes the SHA-256 hash of an ArrayBuffer using the Web Crypto API.
 * Returns the hex-encoded digest string.
 */
export async function sha256(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Downloads the APK from `url`, verifies its SHA-256 hash against `expectedHash`
 * (if provided), and triggers the Android installer.
 * Only works on the MOBILE (Capacitor) build with Android.
 *
 * @param {string} url - Direct download URL for the APK
 * @param {string|null} expectedHash - Expected SHA-256 hex string (from .sha256 asset), or null to skip verification
 * @param {function|null} onProgress - Called with (received, total) bytes during download, or null
 */
export async function downloadAndInstall(url, expectedHash = null, onProgress = null) {
  if (!MOBILE) {
    // On web, just open the release page
    window.open(LATEST_RELEASE_PAGE_URL, '_blank', 'noopener')
    return
  }

  const { Filesystem, Directory } = await import('@capacitor/filesystem')

  // Download with progress tracking via ReadableStream
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)

  const total = parseInt(res.headers.get('content-length') || '0', 10)
  const reader = res.body.getReader()
  const chunks = []
  let received = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (onProgress) onProgress(received, total)
  }

  // Reassemble into a single blob
  const blob = new Blob(chunks)

  // Size check: an APK should be at least 100 KB
  if (blob.size < 100_000) {
    throw new Error('Downloaded file is too small to be a valid APK (' + blob.size + ' bytes)')
  }

  // SHA-256 integrity check
  if (expectedHash) {
    const buffer = await blob.arrayBuffer()
    const actualHash = await sha256(buffer)
    if (actualHash !== expectedHash.toLowerCase().trim()) {
      throw new Error('SHA-256 mismatch — download may be corrupted or tampered with')
    }
  }

  // Convert blob to base64
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

  const fileName = 'nextuin-gym-update.apk'
  await Filesystem.writeFile({
    path: fileName,
    directory: Directory.Cache,
    data: base64,
  })

  // Use the local InstallPlugin to trigger the Android package installer
  const { registerPlugin } = await import('@capacitor/core')
  const Install = registerPlugin('Install')
  await Install.installApk({ fileName })
}
