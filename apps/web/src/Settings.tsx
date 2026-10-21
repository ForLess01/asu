import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Cloud, Download, Upload, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import { emptyWorkspace, parseWorkspace, revise } from '../../../packages/domain/src/index';
import { useAsu } from './context';
import { PageHeading } from './components';
import { HouseholdForm } from './forms';
import { authenticateEmail, cloud, fetchSnapshot, googleSignInUrl, pushSnapshot, type CloudIdentity, type CloudSnapshot } from './cloud';
import { downloadWorkspace } from './storage';
import { formatTime } from './i18n';

function EmailAccount({ onConnected }: { onConnected: () => Promise<void> }) {
  const { t, online } = useAsu();
  const [action, setAction] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [pending, setPending] = useState(false), [error, setError] = useState<'email' | 'google' | null>(null), [verification, setVerification] = useState(false);
  const [touched, setTouched] = useState({ name: false, email: false, password: false });
  const errors = {
    name: action === 'signup' && (!name.trim() || name.trim().length > 100) ? t('Ingresa un nombre de hasta 100 caracteres.', 'Enter a name of up to 100 characters.') : '',
    email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254 ? t('Ingresa un correo electrónico válido.', 'Enter a valid email address.') : '',
    password: password.length < 8 || password.length > 128 ? t('La contraseña debe tener entre 8 y 128 caracteres.', 'Password must contain between 8 and 128 characters.') : '',
  };
  const invalid = (field: keyof typeof touched) => touched[field] && !!errors[field];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || !online) return;
    setTouched({ name: true, email: true, password: true }); setError(null); setVerification(false);
    if (Object.values(errors).some(Boolean)) { setPassword(''); return; }
    // Credentials stay only in this mounted form and the authentication request, never the workspace.
    const fields = { name: name.trim(), email: email.trim(), password };
    setPassword(''); setPending(true); setTouched({ name: false, email: false, password: false });
    try {
      if (await authenticateEmail(action, fields) === 'verification-required') setVerification(true);
      else await onConnected();
    } catch { setError('email'); }
    finally { setPending(false); }
  };
  return <div className="account-form">
    <p>{t('Conecta una cuenta solo si quieres una copia remota. El uso local no requiere registro.', 'Connect an account only if you want a remote copy. Local use does not require registration.')}</p>
    <div className="button-row auth-modes"><button type="button" aria-pressed={action === 'signin'} disabled={pending} onClick={() => { setAction('signin'); setPassword(''); setTouched({ name: false, email: false, password: false }); setError(null); setVerification(false); }}>{t('Ingresar', 'Sign in')}</button><button type="button" aria-pressed={action === 'signup'} disabled={pending} onClick={() => { setAction('signup'); setPassword(''); setTouched({ name: false, email: false, password: false }); setError(null); setVerification(false); }}>{t('Crear cuenta', 'Create account')}</button></div>
    <form onSubmit={event => void submit(event)} noValidate aria-label={t('Cuenta por correo', 'Email account')} aria-busy={pending}>
      <p className="hint">{t('Todos los campos son obligatorios. La contraseña se borra del formulario al enviar.', 'All fields are required. The password is cleared from the form when submitted.')}</p>
      <fieldset disabled={pending || !online}>
        {action === 'signup' && <label>{t('Nombre de la cuenta', 'Account name')}<input required autoComplete="name" value={name} maxLength={100} onChange={event => setName(event.target.value)} onBlur={() => setTouched(value => ({ ...value, name: true }))} aria-invalid={invalid('name')} aria-describedby={invalid('name') ? 'auth-validation' : undefined} /></label>}
        <label>{t('Correo electrónico', 'Email address')}<input type="email" required autoComplete="email" value={email} maxLength={254} onChange={event => setEmail(event.target.value)} onBlur={() => setTouched(value => ({ ...value, email: true }))} aria-invalid={invalid('email')} aria-describedby={invalid('email') ? 'auth-validation' : undefined} /></label>
        <label>{t('Contraseña', 'Password')}<input type="password" required autoComplete={action === 'signup' ? 'new-password' : 'current-password'} minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} onBlur={() => setTouched(value => ({ ...value, password: true }))} aria-invalid={invalid('password')} aria-describedby={invalid('password') ? 'auth-validation' : undefined} /></label>
        {Object.keys(touched).some(field => invalid(field as keyof typeof touched)) && <p id="auth-validation" className="form-error" role="alert">{(Object.keys(touched) as (keyof typeof touched)[]).filter(invalid).map(field => errors[field]).join(' ')}</p>}
        <button className="primary" type="submit">{pending ? t('Conectando…', 'Connecting…') : action === 'signup' ? t('Registrarme con correo', 'Sign up with email') : t('Ingresar con correo', 'Sign in with email')}</button>
      </fieldset>
    </form>
    {verification && <p className="hint" role="status">{t('Revisa tu correo: puede requerirse verificación antes de ingresar. No se confirmó una sesión conectada ni una copia remota.', 'Check your email: verification may be required before signing in. A connected session and a remote copy have not been confirmed.')}</p>}
    {error && <p className="form-error" role="alert">{error === 'google' ? t('No se pudo conectar con Google. El proveedor puede no estar habilitado; usa correo o reintenta más tarde.', 'Could not connect with Google. The provider may not be enabled; use email or try again later.') : t('No se pudo conectar la cuenta. Revisa tus datos, conexión y la verificación del correo, o reintenta más tarde. Tu plan local no cambió.', 'Could not connect the account. Check your details, connection and email verification, or try again later. Your local plan is unchanged.')}</p>}
    <p className="hint">{t('Google es opcional y requiere que el propietario habilite el proveedor.', 'Google is optional and requires the owner to enable the provider.')}</p>
    <button disabled={!online || pending} onClick={() => { setPassword(''); setError(null); setVerification(false); setPending(true); void googleSignInUrl(location.origin).then(url => location.assign(url)).catch(() => setError('google')).finally(() => setPending(false)); }}>{t('Conectar con Google', 'Connect with Google')}</button>
    {!online && <p className="hint" role="status">{t('Sin conexión: puedes seguir usando tu plan local. Conecta una cuenta cuando vuelva la red.', 'Offline: you can keep using your local plan. Connect an account when the network returns.')}</p>}
  </div>;
}

export function Settings() {
  const { state, t, commit, notify, busy, online, mode, switchMode } = useAsu();
  const [identity, setIdentity] = useState<CloudIdentity | null>(null), [cloudBusy, setCloudBusy] = useState(false), [authChecking, setAuthChecking] = useState(!!cloud);
  const authGeneration = useRef(0);
  const [snapshot, setSnapshot] = useState<CloudSnapshot | null | undefined>(undefined), [syncError, setSyncError] = useState(false);
  useEffect(() => {
    if (!cloud) return;
    let active = true;
    const generation = authGeneration.current;
    cloud.auth.getSession().then(({ data, error }) => { if (error) throw error; if (active && authGeneration.current === generation) setIdentity(data.session?.user ?? null); }).catch(() => { if (active) setSyncError(true); }).finally(() => { if (active) setAuthChecking(false); });
    const { data } = cloud.auth.onAuthStateChange((_event, session) => { if (active) { authGeneration.current++; setIdentity(session?.user ?? null); setSnapshot(undefined); setAuthChecking(false); } });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  const runCloud = async (action: (isCurrent: () => boolean) => Promise<void>) => {
    const generation = authGeneration.current;
    const isCurrent = () => generation === authGeneration.current;
    setCloudBusy(true); setSyncError(false);
    try { await action(isCurrent); }
    catch { if (isCurrent()) { setSnapshot(undefined); setSyncError(true); notify(t('No se pudo sincronizar. Puede haber un conflicto o el servicio no está disponible. Tu plan local no cambió; consulta la versión remota antes de reintentar.', 'Sync failed. There may be a conflict or the service is unavailable. Your local plan is unchanged; fetch the remote version before retrying.'), true); } }
    finally { setCloudBusy(false); }
  };
  const restore = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('too-large');
      const restored = parseWorkspace(await file.text());
      if (!confirm(t('¿Reemplazar este plan local con el archivo validado? Exporta primero si quieres conservarlo.', 'Replace this local plan with the validated file? Export first if you want to keep it.'))) return;
      await commit(revise(state, draft => Object.assign(draft, restored)));
    } catch { notify(t('Archivo inválido o incompatible (máximo 5 MB). No se cambió tu plan.', 'Invalid or incompatible file (maximum 5 MB). Your plan was not changed.'), true); }
  };
  return <><PageHeading eyebrow={t('Siempre bajo tu control', 'Always in your control')} title={t('Tu hogar y tus datos.', 'Your household. Your data.')} description={t('Sin dirección exacta, sin registro obligatorio y sin envíos al modelo.', 'No exact address, no required account, and no household data sent to the model.')} />
    <div className="settings-grid"><section className="panel"><h2>{t('Mi hogar', 'My household')}</h2><HouseholdForm key={JSON.stringify(state.household)} /><div className="settings-language"><label>{t('Idioma de la aplicación', 'App language')}<select value={state.locale} disabled={busy} onChange={e => void commit(revise(state, draft => { draft.locale = e.target.value as 'en' | 'es-PE'; }))}><option value="es-PE">Español (Perú)</option><option value="en">English</option></select></label></div></section>
    <div><section className="panel"><div className="section-heading"><h2>{t('Guardado en este dispositivo', 'Saved on this device')}</h2><ShieldCheck size={21} /></div><p>{t('Usamos IndexedDB, no una cuenta oculta. Si borras los datos del navegador, cambias de dispositivo o usas modo privado, puedes perder este plan. Exporta un respaldo.', 'We use IndexedDB, not a hidden account. Clearing browser data, changing devices, or using private mode can lose this plan. Export a backup.')}</p><p className="hint">{t('Última edición', 'Last edited')}: {formatTime(state.updatedAt, state.locale)} · {t('versión local', 'local revision')} {state.revision} · {t('esquema', 'schema')} 1</p><div className="button-row"><button onClick={() => downloadWorkspace(state)}><Download size={18} />{t('Exportar mis datos JSON', 'Export my data JSON')}</button><label className="button file-button"><Upload size={18} />{t('Restaurar JSON', 'Restore JSON')}<input type="file" accept="application/json,.json" onChange={restore} disabled={busy} aria-label={t('Restaurar respaldo JSON', 'Restore JSON backup')} /></label></div></section>
    <section className="panel"><div className="section-heading"><h2>{t('Sincronización opcional', 'Optional sync')}</h2><Cloud size={21} /></div>
      {!cloud ? <><span className="badge">{t('No configurada · solo local', 'Not configured · local only')}</span><p>{t('No hay conexión a Neon en esta instalación. Tu hogar funciona sin ella. Nunca mostramos una sincronización que no existe.', 'There is no Neon connection in this installation. Your household works without it. We never show synchronization that does not exist.')}</p></> : mode === 'example' ? <p>{t('El ejemplo no se sincroniza. Vuelve a tus datos para conectar una cuenta.', 'Examples are not synchronized. Return to your own data to connect an account.')}</p> : authChecking ? <p role="status">{t('Comprobando cuenta…', 'Checking account…')}</p> : !identity ? <EmailAccount onConnected={async () => { const { data, error } = await cloud!.auth.getSession(); if (error) throw error; if (!data.session?.user) throw new Error('auth-session-unconfirmed'); authGeneration.current++; setIdentity(data.session.user); setSnapshot(undefined); setSyncError(false); }} /> : <>
        <span className="badge">{t('Cuenta conectada · sincronización manual', 'Account connected · manual sync')}</span>{identity.email && <p className="account-identity">{identity.email}</p>}<p>{t('Consulta primero la versión remota. Elige subir o recuperar; nunca mezclamos ni sobrescribimos en silencio. Una versión distinta produce un conflicto.', 'Fetch the remote version first. Choose upload or restore; we never silently merge or overwrite. A different revision produces a conflict.')}</p>
        <div className="button-row"><button disabled={!online || cloudBusy} onClick={() => void runCloud(async isCurrent => { const remote = await fetchSnapshot(); if (isCurrent()) setSnapshot(remote); })}>{cloudBusy ? t('Consultando…', 'Working…') : t('Consultar versión remota', 'Fetch remote version')}</button><button disabled={cloudBusy || !online} onClick={() => void runCloud(async () => { const { error } = await cloud!.auth.signOut(); if (error) throw error; authGeneration.current++; setIdentity(null); setSnapshot(undefined); })}><LogOut size={18} />{t('Desconectar', 'Disconnect')}</button></div>
        {snapshot !== undefined && <div className="sync-choice"><p>{snapshot ? `${t('Versión remota', 'Remote revision')}: ${snapshot.revision} · ${formatTime(snapshot.payload.updatedAt, state.locale)}` : t('Todavía no hay una copia remota.', 'No remote copy yet.')}</p><div className="button-row"><button disabled={cloudBusy || busy || !online} onClick={() => { if (confirm(t('¿Subir este plan local a tu cuenta? No incluye credenciales.', 'Upload this local plan to your account? Credentials are excluded.'))) void runCloud(async isCurrent => { const remote = await pushSnapshot(state, snapshot); if (isCurrent()) { setSnapshot(remote); notify(t('Copia remota guardada.', 'Remote copy saved.')); } }); }}><Upload size={18} />{t('Subir mi plan', 'Upload my plan')}</button>{snapshot && <button disabled={cloudBusy || busy} onClick={() => { if (confirm(t('¿Reemplazar tu plan local por esta copia remota?', 'Replace your local plan with this remote copy?'))) void commit(revise(state, draft => Object.assign(draft, snapshot.payload))); }}><Download size={18} />{t('Recuperar copia', 'Restore copy')}</button>}</div></div>}
      </>}
      {syncError && <p className="form-error" role="alert">{t('Sincronización pendiente. Revisa conexión, configuración o conflicto de versión y vuelve a consultar.', 'Sync pending. Check connectivity, configuration, or a revision conflict and fetch again.')}</p>}
      <p className="hint">{t('Una cuenta, un hogar. Compartir con miembros está pendiente. Desconectar conserva los datos de invitado; exporta y restablece en dispositivos compartidos.', 'One account, one household. Member sharing is deferred. Disconnecting keeps guest data; export and reset on shared devices.')}</p>
    </section>
    <section className="panel"><h2>{t('Explorar sin cambiar tus datos', 'Explore without changing your data')}</h2><p>{t('El ejemplo tiene su propio espacio local. No se sube a ninguna cuenta ni se usa como evidencia real.', 'The example has its own local workspace. It is not uploaded to an account or used as real evidence.')}</p><button onClick={() => void switchMode(mode === 'example' ? 'guest' : 'example')}>{mode === 'example' ? t('Volver a mis datos', 'Back to my data') : t('Abrir ejemplo', 'Open example')}</button></section>
    <section className="panel danger-zone"><h2>{t('Restablecer este plan local', 'Reset this local plan')}</h2><p>{t('Elimina el hogar, recipientes, actividades, incidentes y tareas del espacio actual en este dispositivo. No borra copias remotas ni el otro espacio (ejemplo/invitado).', 'Removes the household, containers, activities, incidents, and tasks in this workspace on this device. Does not delete remote copies or the other workspace (example/guest).')}</p><button className="danger" disabled={busy} onClick={() => { if (confirm(t('¿Borrar este plan local? Esta acción no se puede deshacer. Exporta primero si necesitas un respaldo.', 'Delete this local plan? This cannot be undone. Export first if you need a backup.'))) void commit(revise(state, draft => Object.assign(draft, emptyWorkspace()))); }}><Trash2 size={18} />{t('Borrar plan local', 'Delete local plan')}</button></section></div></div>
  </>;
}
