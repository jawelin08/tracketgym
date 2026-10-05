import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import './index.css'

// App.jsx restores per-route scroll itself; the browser's own attempt races it.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

const spotifyCallback = new URLSearchParams(location.search)
if (
  location.pathname === '/settings' &&
  (spotifyCallback.has('code') || spotifyCallback.has('error')) &&
  location.hash !== '#/settings'
) {
  history.replaceState(history.state, '', location.pathname + location.search + '#/settings')
}

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)

// Not in the mobile build: the native shell already serves everything from disk.
if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
