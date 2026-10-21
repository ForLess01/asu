import { useEffect, useState, type ChangeEvent } from 'react';
import { Cloud, Download, Upload, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import { emptyWorkspace, parseWorkspace, revise } from '../../../packages/domain/src/index';
import { useAsu } from './context';
import { PageHeading } from './components';
import { HouseholdForm } from './forms';
import { cloud, fetchSnapshot, pushSnapshot, type CloudSnapshot } from './cloud';
import { downloadWorkspace } from './storage';
import { formatTime } from './i18n';

export function Settings() {
  const { state, t, commit, notify, busy, online, mode, switchMode } = useAsu();
  const [authenticated, setAuthenticated] = useState(false), [cloudBusy, setCloudBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<CloudSnapshot | null | undefined>(undefined), [syncError, setSyncError] = useState(false);
  useEffect(() => {
    if (!cloud) return;
    cloud.auth.getSession().then(({ data }) => setAuthenticated(!!data.session)).catch(() => setSyncError(true));
    const { data } = cloud.auth.onAuthStateChange((_event, session) => { setAuthenticated(!!session); setSnapshot(undefined); });
    return () => data.subscription.unsubscribe();
  }, []);
  const runCloud = async (action: () => Promise<void>) => {
    setCloudBusy(true); setSyncError(false);
    try { await action(); }
    catch { setSyncError(true); notify(t('No se pudo sincronizar. Puede haber un conflicto o el servicio no está disponible. Tu plan local no cambió; consulta la versión remota antes de reintentar.', 'Sync failed. There may be a conflict or the service is unavailable. Your local plan is unchanged; fetch the remote version before retrying.'), true); }
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
      {!cloud ? <><span className="badge">{t('No configurada · solo local', 'Not configured · local only')}</span><p>{t('No hay conexión a Supabase en esta instalación. Tu hogar funciona sin ella. Nunca mostramos una sincronización que no existe.', 'There is no Supabase connection in this installation. Your household works without it. We never show synchronization that does not exist.')}</p></> : mode === 'example' ? <p>{t('El ejemplo no se sincroniza. Vuelve a tus datos para conectar una cuenta.', 'Examples are not synchronized. Return to your own data to connect an account.')}</p> : !authenticated ? <><p>{t('Conecta Google solo si quieres guardar una copia en tu cuenta. La configuración del servicio y OAuth debe estar habilitada por el propietario.', 'Connect Google only if you want to save a copy in your account. The owner must configure the service and OAuth.')}</p><button className="primary" disabled={!online || cloudBusy} onClick={() => void runCloud(async () => { const result = await cloud!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin, scopes: 'email' } }); if (result.error) throw result.error; })}>{t('Conectar con Google', 'Connect with Google')}</button></> : <>
        <span className="badge">{t('Cuenta conectada · sincronización manual', 'Account connected · manual sync')}</span><p>{t('Consulta primero la versión remota. Elige subir o recuperar; nunca mezclamos ni sobrescribimos en silencio. Una versión distinta produce un conflicto.', 'Fetch the remote version first. Choose upload or restore; we never silently merge or overwrite. A different revision produces a conflict.')}</p>
        <div className="button-row"><button disabled={!online || cloudBusy} onClick={() => void runCloud(async () => { setSnapshot(await fetchSnapshot()); })}>{cloudBusy ? t('Consultando…', 'Working…') : t('Consultar versión remota', 'Fetch remote version')}</button><button disabled={cloudBusy} onClick={() => void runCloud(async () => { await cloud!.auth.signOut(); setSnapshot(undefined); })}><LogOut size={18} />{t('Desconectar', 'Disconnect')}</button></div>
        {snapshot !== undefined && <div className="sync-choice"><p>{snapshot ? `${t('Versión remota', 'Remote revision')}: ${snapshot.revision} · ${formatTime(snapshot.payload.updatedAt, state.locale)}` : t('Todavía no hay una copia remota.', 'No remote copy yet.')}</p><div className="button-row"><button disabled={cloudBusy || busy || !online} onClick={() => { if (confirm(t('¿Subir este plan local a tu cuenta? No incluye credenciales.', 'Upload this local plan to your account? Credentials are excluded.'))) void runCloud(async () => { setSnapshot(await pushSnapshot(state, snapshot)); notify(t('Copia remota guardada.', 'Remote copy saved.')); }); }}><Upload size={18} />{t('Subir mi plan', 'Upload my plan')}</button>{snapshot && <button disabled={cloudBusy || busy} onClick={() => { if (confirm(t('¿Reemplazar tu plan local por esta copia remota?', 'Replace your local plan with this remote copy?'))) void commit(revise(state, draft => Object.assign(draft, snapshot.payload))); }}><Download size={18} />{t('Recuperar copia', 'Restore copy')}</button>}</div></div>}
      </>}
      {syncError && <p className="form-error" role="alert">{t('Sincronización pendiente. Revisa conexión, configuración o conflicto de versión y vuelve a consultar.', 'Sync pending. Check connectivity, configuration, or a revision conflict and fetch again.')}</p>}
      <p className="hint">{t('Una cuenta, un hogar. Compartir con miembros está pendiente. Desconectar conserva los datos de invitado; exporta y restablece en dispositivos compartidos.', 'One account, one household. Member sharing is deferred. Disconnecting keeps guest data; export and reset on shared devices.')}</p>
    </section>
    <section className="panel"><h2>{t('Explorar sin cambiar tus datos', 'Explore without changing your data')}</h2><p>{t('El ejemplo tiene su propio espacio local. No se sube a ninguna cuenta ni se usa como evidencia real.', 'The example has its own local workspace. It is not uploaded to an account or used as real evidence.')}</p><button onClick={() => void switchMode(mode === 'example' ? 'guest' : 'example')}>{mode === 'example' ? t('Volver a mis datos', 'Back to my data') : t('Abrir ejemplo', 'Open example')}</button></section>
    <section className="panel danger-zone"><h2>{t('Restablecer este plan local', 'Reset this local plan')}</h2><p>{t('Elimina el hogar, recipientes, actividades, incidentes y tareas del espacio actual en este dispositivo. No borra copias remotas ni el otro espacio (ejemplo/invitado).', 'Removes the household, containers, activities, incidents, and tasks in this workspace on this device. Does not delete remote copies or the other workspace (example/guest).')}</p><button className="danger" disabled={busy} onClick={() => { if (confirm(t('¿Borrar este plan local? Esta acción no se puede deshacer. Exporta primero si necesitas un respaldo.', 'Delete this local plan? This cannot be undone. Export first if you need a backup.'))) void commit(revise(state, draft => Object.assign(draft, emptyWorkspace()))); }}><Trash2 size={18} />{t('Borrar plan local', 'Delete local plan')}</button></section></div></div>
  </>;
}
