import { useEffect, useState } from 'react'
import { useStore, hasData } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { webauthnOK, passkeyLogin, passkeyRegister, BIO, VAULT } from '../lib/api.js'
import { guestAllowed } from '../lib/guest.js'
import { askAddDeviceData } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, TextField } from '../components/ui.jsx'

export default function Login() {
  const { setUser, adoptProfile, pushState, pullState, setGuest, loadConfig } = useStore()
  const toast = useUI(s => s.toast)
  const [mode, setMode] = useState('login')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [cfg, setCfg] = useState(null)

  useEffect(() => {
    loadConfig().then(c => setCfg(c || null)).catch(() => {})
  }, [loadConfig])

  const canPasskey = webauthnOK()
  const allowGuest = guestAllowed(cfg)
  const inviteOnly = !!cfg?.invite_only

  const signIn = async () => {
    if (!canPasskey || busy) return
    setBusy(true)
    try {
      const u = await passkeyLogin()
      setUser(u)
      await adoptProfile(askAddDeviceData)
      toast(t('Welcome back, {0}', u.name))
    } catch (e) {
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Sign-in failed'))
    } finally {
      setBusy(false)
    }
  }

  const register = async () => {
    if (!canPasskey || busy) return
    const n = name.trim()
    if (!n) { toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { toast(t('An invite code is required')); return }
    setBusy(true)
    try {
      const u = await passkeyRegister(n, code.trim())
      setUser(u)
      if (hasData(useStore.getState().S)) {
        await pushState()
        toast(t('Profile created — data moved into it'))
      } else {
        await pullState()
        toast(t('Welcome, {0}', u.name))
      }
    } catch (e) {
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Registration failed'))
    } finally {
      setBusy(false)
    }
  }

  const useLocalOnly = () => {
    if (!allowGuest) return
    setGuest(true)
    toast(t('Guest mode — data lives only in this browser.'))
  }

  const wrap = { minHeight: '82vh', display: 'grid', placeItems: 'center' }

  return (
    <div className="narrow" style={wrap}>
      <div className="card" style={{ width: '100%', maxWidth: 520, padding: 22, borderRadius: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb,var(--acc) 16%,transparent)', color: 'var(--acc)', fontSize: 24 }}>
            <Icon name="dumbbell" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 30, letterSpacing: '-.02em' }}>GYMTracker</h1>
            <div className="muted small">{t('Entrenamiento personal, perfiles separados y sincronización segura')}</div>
          </div>
        </div>

        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          <button className={'chip' + (mode === 'login' ? ' on' : '')} onClick={() => setMode('login')}>{t('Sign in with passkey')}</button>
          <button className={'chip' + (mode === 'register' ? ' on' : '')} onClick={() => setMode('register')}>{t('Create new profile')}</button>
        </div>

        {!canPasskey && (
          <div className="card small muted" style={{ marginBottom: 12 }}>
            {allowGuest
              ? t("This browser doesn't support passkeys — you can still use openGym locally on this device.")
              : t("This browser doesn't support passkeys, and this instance requires an account. Try a browser or device with passkey support.")}
          </div>
        )}

        {mode === 'register' && (
          <>
            <TextField value={name} onChange={e => setName(e.target.value)} placeholder={t('Your name')} maxLength={40} />
            {inviteOnly && (
              <>
                <div style={{ height: 10 }} />
                <input
                  className="input"
                  placeholder={t('Invite code')}
                  value={code}
                  maxLength={40}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }}
                />
                <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
              </>
            )}
            <div style={{ height: 12 }} />
            <Button variant="primary" icon="personPlus" onClick={register} disabled={!canPasskey || busy}>{t('Create passkey')}</Button>
            <div className="dim small" style={{ marginTop: 10 }}>{t('Pick a name, then confirm with {0}. The passkey is saved in your device — no password needed.', BIO)}</div>
          </>
        )}

        {mode === 'login' && (
          <>
            <Button variant="primary" icon="key" onClick={signIn} disabled={!canPasskey || busy}>{t('Sign in with passkey')}</Button>
            <div className="dim small" style={{ marginTop: 10 }}>{t('Passkeys use {0} — no passwords.', VAULT)}</div>
          </>
        )}

        {allowGuest && (
          <>
            <div style={{ height: 12 }} />
            <Button variant="ghost" icon="mobile" onClick={useLocalOnly}>{t('Continue without account')}</Button>
          </>
        )}
      </div>
    </div>
  )
}
