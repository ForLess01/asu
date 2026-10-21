import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Cloud, Download, Upload, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import { emptyWorkspace, parseWorkspace, revise } from '../../../packages/domain/src/index';
import { useAsu } from './context';
import { PageHeading } from './components';
import { HouseholdForm } from './forms';
import { authenticateEmail, cloud, googleSignInUrl } from './cloud';
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
  const { state, t, commit, notify, busy, online, mode, switchMode, account } = useAsu();
  const [cloudBusy, setCloudBusy] = useState(false), [accountError, setAccountError] = useState(false);
  const inAccount = mode !== 'example' && !!account.identity;
  const runCloud = async (action: () => Promise<void>) => {
    setCloudBusy(true); setAccountError(false);
    try { await action(); }
    catch { setAccountError(true); notify(t('No se pudo completar la operación de cuenta. Tus datos locales se conservaron.', 'The account operation could not complete. Your local data was retained.'), true); }
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
    <div><section className="panel"><div className="section-heading"><h2>{t('Cuenta y guardado automático', 'Account and automatic saving')}</h2><Cloud size={21} /></div>
      {!cloud ? <><span className="badge">{t('No configurada · solo local', 'Not configured · local only')}</span><p>{t('No hay conexión a Neon en esta instalación. Tu hogar funciona sin ella.', 'Neon is not configured in this installation. Your household still works locally.')}</p></> : mode === 'example' ? <p>{t('El ejemplo no se sincroniza. Vuelve a tus datos para conectar una cuenta.', 'Examples are not synchronized. Return to your own data to connect an account.')}</p> : account.checking ? <p role="status">{t('Comprobando cuenta…', 'Checking account…')}</p> : !account.identity ? <EmailAccount onConnected={account.refreshSession} /> : <>
        <span className="badge">{t('Cuenta conectada · guardado automático', 'Account connected · automatic saving')}</span>{account.identity.email && <p className="account-identity">{account.identity.email}</p>}
        <p>{t('Los cambios guardados se envían automáticamente a Neon. Al ingresar en otro dispositivo, recuperamos tu plan. Sin conexión conservamos los cambios en la copia local de esta cuenta.', 'Saved changes are sent automatically to Neon. Sign in on another device to recover your plan. Offline changes remain in this account’s local backup.')}</p>
        {account.record?.syncedAt && <p className="hint">{t('Última confirmación de Neon', 'Last Neon confirmation')}: {formatTime(account.record.syncedAt, state.locale)}</p>}
        {account.status === 'conflict' && <div className="sync-conflict" role="alert"><p>{t('Otro dispositivo tiene cambios diferentes. No sobrescribimos ninguna copia automáticamente. Exporta tus datos antes de elegir.', 'Another device has different changes. Neither copy is overwritten automatically. Export your data before choosing.')}</p><div className="button-row"><button disabled={!online || cloudBusy} onClick={() => { if (confirm(t('¿Reemplazar esta copia local por el plan de Neon?', 'Replace this local copy with the Neon plan?'))) void runCloud(() => account.sync.resolve('remote')); }}>{t('Usar copia de Neon', 'Use Neon copy')}</button><button disabled={!online || cloudBusy} onClick={() => { if (confirm(t('¿Usar esta copia local para reemplazar el plan de Neon? Consultaremos su última versión antes de guardar.', 'Use this local copy to replace the Neon plan? Its latest revision will be checked before saving.'))) void runCloud(() => account.sync.resolve('local')); }}>{t('Conservar mis cambios locales', 'Keep my local changes')}</button></div></div>}
        {account.status === 'error' && <p className="form-error" role="alert">{t('Hay cambios pendientes o no pudimos consultar Neon. La copia local se conserva. Reintenta cuando haya conexión.', 'Changes are pending or Neon could not be reached. The local backup is retained. Retry when connected.')}</p>}
        <div className="button-row"><button disabled={!online || cloudBusy || account.status === 'syncing'} onClick={() => void runCloud(() => account.sync.refresh())}>{cloudBusy ? t('Consultando…', 'Working…') : account.status === 'error' ? t('Reintentar guardado', 'Retry saving') : t('Actualizar desde Neon', 'Refresh from Neon')}</button><button disabled={cloudBusy || !online} onClick={() => void runCloud(account.signOut)}><LogOut size={18} />{t('Desconectar', 'Disconnect')}</button></div>
        <p className="hint">{t('Al desconectarte vuelves al plan invitado. La copia offline de tu cuenta permanece separada y se recupera al ingresar nuevamente.', 'Signing out returns to the guest plan. Your separate account backup is recovered when you sign in again.')}</p>
      </>}
      {accountError && <p className="form-error" role="alert">{t('No se pudo completar la operación de cuenta. La sesión y los datos no se dan por modificados.', 'The account operation did not complete. Session or data changes are not assumed.')}</p>}
    </section>
    <section className="panel"><div className="section-heading"><h2>{inAccount ? t('Respaldo local y exportación', 'Local backup and export') : t('Guardado en este dispositivo', 'Saved on this device')}</h2><ShieldCheck size={21} /></div><p>{inAccount ? t('Esta copia permite seguir trabajando sin conexión. Solo mostramos “Guardado en Neon” cuando el servidor confirma la escritura. Exportar no incluye identidad ni credenciales.', 'This backup lets you keep working offline. “Saved in Neon” appears only after server confirmation. Exports exclude identity and credentials.') : t('Tu plan invitado usa IndexedDB. Si borras los datos del navegador, puedes perderlo. Conecta una cuenta para guardarlo automáticamente en Neon.', 'Your guest plan uses IndexedDB. Clearing browser data can lose it. Connect an account to save automatically in Neon.')}</p><p className="hint">{t('Última edición', 'Last edited')}: {formatTime(state.updatedAt, state.locale)} · {t('versión local', 'local revision')} {state.revision} · {t('esquema', 'schema')} 1</p><div className="button-row"><button onClick={() => downloadWorkspace(state)}><Download size={18} />{t('Exportar mis datos JSON', 'Export my data JSON')}</button><label className="button file-button"><Upload size={18} />{t('Restaurar JSON', 'Restore JSON')}<input type="file" accept="application/json,.json" onChange={restore} disabled={busy} aria-label={t('Restaurar respaldo JSON', 'Restore JSON backup')} /></label></div></section>
    <section className="panel"><h2>{t('Explorar sin cambiar tus datos', 'Explore without changing your data')}</h2><p>{t('El ejemplo tiene su propio espacio local. No se sube a ninguna cuenta ni se usa como evidencia real.', 'The example has its own local workspace. It is not uploaded to an account or used as real evidence.')}</p><button onClick={() => void switchMode(mode === 'example' ? 'guest' : 'example')}>{mode === 'example' ? t('Volver a mis datos', 'Back to my data') : t('Abrir ejemplo', 'Open example')}</button></section>
    <section className="panel danger-zone"><h2>{inAccount ? t('Vaciar el plan de mi cuenta', 'Clear my account plan') : t('Restablecer este plan local', 'Reset this local plan')}</h2><p>{inAccount ? t('Vaciar el plan también se guardará en Neon. No elimina tu cuenta. Exporta un respaldo antes de continuar.', 'Clearing the plan will also be saved in Neon. Your account is not deleted. Export a backup first.') : t('Elimina el plan de este espacio local. No borra cuentas ni el espacio de ejemplo/invitado separado.', 'Clears this local workspace. Accounts and the separate example/guest workspace are not deleted.')}</p><button className="danger" disabled={busy} onClick={() => { if (confirm(inAccount ? t('¿Vaciar este plan en la cuenta y sincronizar el cambio con Neon? Exporta primero un respaldo.', 'Clear this account plan and sync the change to Neon? Export a backup first.') : t('¿Borrar este plan local? Esta acción no se puede deshacer. Exporta primero si necesitas un respaldo.', 'Delete this local plan? This cannot be undone. Export first if you need a backup.'))) void commit(revise(state, draft => Object.assign(draft, emptyWorkspace()))); }}><Trash2 size={18} />{inAccount ? t('Vaciar plan de la cuenta', 'Clear account plan') : t('Borrar plan local', 'Delete local plan')}</button></section></div></div>
  </>;
}
