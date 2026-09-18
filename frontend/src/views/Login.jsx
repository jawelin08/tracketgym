import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

export default function Login() {
  const { setUser, adoptProfile } = useStore()

  const personalLogin = async () => {
    const user = { id: 'mi-tracking', name: 'Mi tracking' }
    setUser(user)
    await adoptProfile(() => false)
    useUI.getState().toast(t('Bienvenido a tu tracking personal'))
  }

  const head = <>
    <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="dumbbell" /></div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>GYMTracker</h1>
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 20 }}>{t('Tu tracking personal')}</div>
      <div className="card small muted" style={{ textAlign: 'left', marginBottom: 18 }}>
        {t('Todo queda en este dispositivo y no se mezcla con perfiles de otros usuarios.')}
      </div>
      <Button variant="primary" icon="person" onClick={personalLogin}>{t('Entrar a Mi tracking')}</Button>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.5 }}>
        {t('Cada usuario tiene su propio plan, entrenamientos y peso corporal.')}
      </div>
    </div>
  )
}
