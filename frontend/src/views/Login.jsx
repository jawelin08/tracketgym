import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { passwordLogin, passwordRegister } from '../lib/api.js'
import { guestAllowed } from '../lib/guest.js'
import { askAddDeviceData } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, TextField } from '../components/ui.jsx'

export default function Login() {
  const { setUser, adoptProfile, setGuest, loadConfig } = useStore()
  const toast = useUI(s => s.toast)
  const [mode, setMode] = useState('login')
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [code, setCode] = useState('')
  const [cfg, setCfg] = useState(null)

  useEffect(() => {
    loadConfig().then(c => setCfg(c || null)).catch(() => {})
  }, [loadConfig])

  const allowGuest = guestAllowed(cfg)
  const inviteOnly = !!cfg?.invite_only

  const signIn = async () => {
    if (busy) return
    const id = identifier.trim()
    if (!id || !password) { toast(t('Rellena usuario/correo y contraseña')); return }
    setBusy(true)
    try {
      const u = await passwordLogin({ identifier: id, password })
      setUser(u)
      await adoptProfile(askAddDeviceData)
      toast(t('Bienvenido de nuevo, {0}', u.name))
    } catch (e) {
      toast(e.message || t('No se pudo iniciar sesión'))
    } finally {
      setBusy(false)
    }
  }

  const register = async () => {
    if (busy) return
    const e = email.trim().toLowerCase()
    const uName = username.trim()
    if (!e || !uName || !password) { toast(t('Completa email, usuario y contraseña')); return }
    if (password.length < 8) { toast(t('La contraseña debe tener al menos 8 caracteres')); return }
    if (password !== password2) { toast(t('Las contraseñas no coinciden')); return }
    if (inviteOnly && !code.trim()) { toast(t('Se requiere código de invitación')); return }
    setBusy(true)
    try {
      const u = await passwordRegister({ email: e, username: uName, password, code: code.trim() })
      setUser(u)
      const adopted = await adoptProfile(askAddDeviceData)
      if (adopted?.added) {
        toast(t('Cuenta creada: tus datos se han movido al perfil'))
      } else {
        toast(t('Bienvenido, {0}', u.name))
      }
    } catch (e) {
      toast(e.message || t('No se pudo crear la cuenta'))
    } finally {
      setBusy(false)
    }
  }

  const useLocalOnly = () => {
    if (!allowGuest) return
    setGuest(true)
    toast(t('Guest mode — data lives only in this browser.'))
  }

  const wrap = { minHeight: '82vh', display: 'grid', placeItems: 'center', paddingTop: 8, paddingBottom: 8 }

  return (
    <div className="narrow" style={wrap}>
      <div className="card" style={{ width: '100%', maxWidth: 520, padding: 22, borderRadius: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb,var(--acc) 16%,transparent)', color: 'var(--acc)', fontSize: 24 }}>
            <Icon name="dumbbell" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 30, letterSpacing: '-.02em' }}>GYMTracker</h1>
            <div className="muted small">{t('Cuenta personal con email, usuario y contraseña')}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          <button className={'chip' + (mode === 'login' ? ' on' : '')} onClick={() => setMode('login')}>{t('Iniciar sesión')}</button>
          <button className={'chip' + (mode === 'register' ? ' on' : '')} onClick={() => setMode('register')}>{t('Crear cuenta')}</button>
        </div>

        {mode === 'register' && (
          <>
            <TextField value={email} onChange={e => setEmail(e.target.value)} placeholder={t('Correo electrónico')} maxLength={120} />
            <div style={{ height: 10 }} />
            <TextField value={username} onChange={e => setUsername(e.target.value)} placeholder={t('Nombre de usuario')} maxLength={40} />
            <div style={{ height: 10 }} />
            <TextField value={password} onChange={e => setPassword(e.target.value)} placeholder={t('Contraseña')} type="password" maxLength={120} />
            <div style={{ height: 10 }} />
            <TextField value={password2} onChange={e => setPassword2(e.target.value)} placeholder={t('Repite la contraseña')} type="password" maxLength={120} />
            {inviteOnly && (
              <>
                <div style={{ height: 10 }} />
                <input
                  className="input"
                  placeholder={t('Código de invitación')}
                  value={code}
                  maxLength={40}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }}
                />
                <div className="dim small" style={{ marginTop: 6 }}>{t('Esta instancia requiere invitación para registrarse.')}</div>
              </>
            )}
            <div style={{ height: 12 }} />
            <Button variant="primary" icon="personPlus" onClick={register} disabled={busy}>{t('Crear cuenta')}</Button>
            <div className="dim small" style={{ marginTop: 10 }}>{t('Tu cuenta queda separada por usuario y contraseña.')}</div>
          </>
        )}

        {mode === 'login' && (
          <>
            <TextField value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder={t('Correo o usuario')} maxLength={120} />
            <div style={{ height: 10 }} />
            <TextField value={password} onChange={e => setPassword(e.target.value)} placeholder={t('Contraseña')} type="password" maxLength={120} />
            <div style={{ height: 12 }} />
            <Button variant="primary" icon="key" onClick={signIn} disabled={busy}>{t('Entrar')}</Button>
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
