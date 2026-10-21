import { useEffect, useRef, useState } from 'react';
import { House, Droplets, SlidersHorizontal, History, ListChecks, Settings2, FlaskConical, Bell, ArrowUpRight, WifiOff, ShieldCheck } from 'lucide-react';
import { emptyWorkspace, exampleWorkspace, revise, type Workspace } from '../../../packages/domain/src/index';
import { Context, type Page } from './context';
import { readWorkspace, writeWorkspace, recoverWorkspace, tabId, type StorageKey } from './storage';
import { translator } from './i18n';
import { Overview, Reserves, Planner, Incidents, Tasks, Settings } from './pages';
import { Lab } from './Lab';
import { HouseholdForm } from './forms';
import { useClock } from './useClock';
import { useAccount } from './useAccount';

const pageIds: Page[] = ['home', 'reserve', 'plan', 'incidents', 'tasks', 'settings', 'lab'];
function hashPage(): Page { const value = location.hash.slice(1) as Page; return pageIds.includes(value) ? value : 'home'; }

export function App() {
  const now = useClock();
  const [local, setState] = useState<Workspace>(emptyWorkspace);
  const [mode, setMode] = useState<StorageKey>('guest');
  const [loading, setLoading] = useState(true), [storageError, setStorageError] = useState('');
  const [saving, setBusy] = useState(false), [online, setOnline] = useState(navigator.onLine);
  const account = useAccount(mode === 'guest' ? local : undefined, online, !loading);
  const inAccount = mode !== 'example' && !!account.identity;
  const state = inAccount && account.record ? account.record.state : local;
  const busy = saving || account.checking || (inAccount && account.status === 'loading');
  const [page, setPage] = useState<Page>(hashPage), [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const lock = useRef(false), current = useRef(state); current.current = state;
  const t = translator(state.locale);
  const notify = (text: string, error = false) => setNotice({ text, error });
  const navigate = (value: Page) => { location.hash = value; setPage(value); };
  useEffect(() => {
    readWorkspace('guest').then(setState).catch(error => setStorageError(error.message)).finally(() => setLoading(false));
    const onHash = () => setPage(hashPage());
    const onOnline = () => setOnline(navigator.onLine);
    addEventListener('hashchange', onHash); addEventListener('online', onOnline); addEventListener('offline', onOnline);
    return () => { removeEventListener('hashchange', onHash); removeEventListener('online', onOnline); removeEventListener('offline', onOnline); };
  }, []);
  useEffect(() => { document.documentElement.lang = state.locale; }, [state.locale]);
  useEffect(() => { document.getElementById('page-title')?.focus({ preventScroll: true }); }, [page]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const channel = new BroadcastChannel('asu-updates');
    const key = inAccount ? `account:${account.identity!.id}` : mode;
    channel.onmessage = event => { if (event.data.sender !== tabId && event.data.key === key && event.data.revision !== current.current.revision) setConflict(true); };
    return () => channel.close();
  }, [mode, inAccount, account.identity?.id]);
  const commit = async (next: Workspace): Promise<boolean> => {
    if (lock.current || conflict) { notify(t('Hay cambios en otra pestaña. Recarga antes de guardar.', 'Another tab changed your data. Reload before saving.'), true); return false; }
    lock.current = true; setBusy(true);
    try {
      if (inAccount) { await account.sync.save(next, account.identity!.id); notify(online ? t('Cambios guardados. Sincronizando con Neon…', 'Changes saved. Syncing with Neon…') : t('Guardado en la copia local. Se sincronizará al volver la conexión.', 'Saved to the local backup. Sync resumes when online.')); }
      else { await writeWorkspace(mode, next, current.current.revision); setState(next); notify(t('Cambios guardados en este dispositivo.', 'Changes saved on this device.')); }
      return true;
    }
    catch (error) { if (error instanceof Error && error.message === 'local-conflict') setConflict(true); notify(t('No se pudo guardar. Conserva esta pestaña y exporta tus datos antes de reintentar.', 'Could not save. Keep this tab open and export your data before retrying.'), true); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  const switchMode = async (nextMode: StorageKey) => {
    setLoading(true);
    try {
      let next = await readWorkspace(nextMode);
      if (nextMode === 'example' && !next.household) { const example = exampleWorkspace(); await writeWorkspace('example', example, next.revision); next = example; }
      setState(next); setMode(nextMode); setConflict(false); navigate('home');
    } catch (error) { notify(t('No se pudo abrir el espacio local.', 'Could not open the local workspace.'), true); }
    finally { setLoading(false); }
  };
  if (loading || (inAccount && !account.record && account.status === 'loading')) return <main className="startup" aria-busy="true"><img src="/brand/asu-logo.svg" width="132" alt="Asu" /><p>{t('Abriendo tu plan…', 'Opening your plan…')}</p><div className="loading-line" /></main>;
  if (inAccount && !account.record) return <main className="startup"><h1>Asu</h1><p>{t('No pudimos abrir la copia de tu cuenta. No se reemplazaron tus datos.', 'Could not open your account backup. Your data was not replaced.')}</p><button onClick={() => void account.sync.refresh()}>{t('Reintentar', 'Retry')}</button><button onClick={() => void account.signOut().catch(() => notify(t('No se pudo cerrar la sesión.', 'Could not sign out.'), true))}>{t('Cerrar sesión', 'Sign out')}</button></main>;
  if (storageError) return <main className="startup"><img src="/brand/asu-logo.svg" width="132" alt="Asu" /><h1>{t('Tus datos necesitan atención', 'Your data needs attention')}</h1><p>{t('No pudimos leer el almacenamiento. No lo hemos sobrescrito. Reintenta o inicia de nuevo solo si aceptas perder el plan local.', 'We could not read storage. It has not been overwritten. Retry, or start over only if you accept losing the local plan.')}</p><button onClick={() => location.reload()}>{t('Reintentar', 'Retry')}</button><button className="danger" onClick={async () => { if (confirm(t('¿Reemplazar los datos locales ilegibles?', 'Replace unreadable local data?'))) { try { setState(await recoverWorkspace('guest')); setStorageError(''); } catch { setStorageError('storage-unavailable'); } } }}>{t('Restablecer almacenamiento', 'Reset storage')}</button></main>;
  const nav = [
    { id: 'home' as const, icon: House, label: t('Mi hogar', 'My home') },
    { id: 'reserve' as const, icon: Droplets, label: t('Mi reserva', 'My reserve') },
    { id: 'plan' as const, icon: SlidersHorizontal, label: t('Mi plan', 'My plan') },
    { id: 'incidents' as const, icon: History, label: t('Cortes', 'Outages') },
    { id: 'tasks' as const, icon: ListChecks, label: t('Pendientes', 'Tasks') },
  ];
  const storageLabel = mode === 'example' ? t('Ejemplo · no se sincroniza', 'Example · never synchronized') : account.checking ? t('Comprobando cuenta…', 'Checking account…') : !inAccount ? t('Invitado · guardado local', 'Guest · local storage') : account.status === 'synced' ? account.record?.remote ? t('Guardado en Neon', 'Saved in Neon') : t('Cuenta lista para guardar', 'Account ready to save') : account.status === 'syncing' ? t('Guardando en Neon…', 'Saving to Neon…') : account.status === 'offline' ? t('Sin conexión · copia local', 'Offline · local backup') : account.status === 'conflict' ? t('Conflicto · revisa tu copia', 'Conflict · review your copy') : account.status === 'error' ? t('Pendiente · copia local segura', 'Pending · local backup retained') : t('Cargando cuenta…', 'Loading account…');
  return <Context.Provider value={{ state, mode, busy, online, now, account, t, commit, notify, navigate, switchMode }}>
    <a className="skip-link" href="#main-content">{t('Saltar al contenido', 'Skip to content')}</a>
    <div className="app-shell">
      <aside className="sidebar"><a href="#home" className="brand" aria-label={t('Asu, inicio', 'Asu home')}><img src="/brand/asu-logo.svg" alt="Asu" /></a><p className="brand-tagline">{t('Tu agua, con un plan.', 'Your water, with a plan.')}</p>
        <nav aria-label={t('Navegación principal', 'Main navigation')}>{nav.map(item => <a key={item.id} href={`#${item.id}`} aria-current={page === item.id ? 'page' : undefined}><item.icon size={21} /><span>{item.label}</span>{item.id === 'tasks' && state.tasks.some(task => !task.done) && <span className="nav-count">{state.tasks.filter(task => !task.done).length}</span>}</a>)}</nav>
        <div className="sidebar-bottom"><a href="#lab" aria-current={page === 'lab' ? 'page' : undefined}><FlaskConical size={20} />{t('Laboratorio', 'Laboratory')}<span className="mini-label">Beta</span></a><a href="#settings" aria-current={page === 'settings' ? 'page' : undefined}><Settings2 size={20} />{t('Ajustes', 'Settings')}</a><div className="local-note"><ShieldCheck size={20} /><div><strong>{t('Tu plan es tuyo', 'Your plan is yours')}</strong><p>{storageLabel}</p></div></div></div>
      </aside>
      <div className="workspace"><header className="topbar"><div className="mobile-brand"><a href="#home"><img src="/brand/asu-logo.svg" alt="Asu" /></a></div><div className="workspace-location"><House size={17} /><span>{state.household?.label ?? t('Bienvenido a Asu', 'Welcome to Asu')}</span>{state.household && <span className="muted desktop-only">/ {state.household.district}</span>}</div><div className="topbar-actions"><button className="language-button" onClick={() => void commit(revise(state, draft => { draft.locale = state.locale === 'en' ? 'es-PE' : 'en'; }))} aria-label={t('Switch to English', 'Cambiar a español')} disabled={busy}>{state.locale === 'en' ? 'ES' : 'EN'}</button><a className="icon-button" href="#tasks" aria-label={t('Notificaciones y pendientes', 'Notifications and tasks')}><Bell size={20} /></a><a href="#settings" className="guest-avatar" aria-label={t('Ajustes de cuenta y datos', 'Account and data settings')}><Settings2 size={20} /></a></div></header>
        {mode === 'example' && <div className="example-banner"><span>{t('Modo ejemplo · datos ficticios separados de tu hogar', 'Example mode · fictional data separate from your household')}</span><button onClick={() => void switchMode('guest')}>{t('Volver a mis datos', 'Back to my data')}<ArrowUpRight size={16} /></button></div>}
        {!online && <div className="banner"><WifiOff size={18} />{t('Sin conexión. Tu plan local sigue disponible; no hay información oficial en vivo.', 'Offline. Your local plan remains available; there is no live official information.')}</div>}
        {inAccount && <div className={`account-status ${account.status === 'error' || account.status === 'conflict' ? 'account-warning' : ''}`} role="status"><ShieldCheck size={18} /><span data-testid="account-save-status">{storageLabel}</span><a href="#settings">{t('Ver cuenta y sincronización', 'Account and sync details')}</a></div>}
        {conflict && <div className="banner warning" role="alert"><span>{t('Otra pestaña cambió el plan. No sobrescribiremos sus cambios.', 'Another tab changed this plan. We will not overwrite its changes.')}</span><button onClick={() => void (inAccount ? account.sync.reloadLocal() : readWorkspace(mode).then(setState)).then(() => setConflict(false)).catch(() => notify(t('No se pudo recargar.', 'Could not reload.'), true))}>{t('Recargar datos', 'Reload data')}</button></div>}
        <main id="main-content" className="main-content">
          {!state.household && page !== 'settings' && page !== 'lab' ? <div className="onboarding"><div className="intro"><span className="eyebrow">{t('Menos incertidumbre, más organización', 'Less uncertainty, more clarity')}</span><h1 id="page-title">{t('Que un corte no te encuentre sin un plan.', 'Make a plan before the water stops.')}</h1><p>{t('Conoce tu reserva, organiza lo esencial y decide con calma. Comienza por tu hogar; puedes añadir el agua después.', 'Know your reserves, organize the essentials, and decide with confidence. Start with your household; add your water later.')}</p><ol className="onboarding-steps"><li><span>1</span>{t('Cuéntanos sobre tu hogar', 'Tell us about your home')}</li><li><span>2</span>{t('Registra el agua que tienes', 'Record the water you have')}</li><li><span>3</span>{t('Compara y organiza tu plan', 'Compare and organize your plan')}</li></ol><button className="text-button" onClick={() => void switchMode('example')}>{t('Primero, explorar un ejemplo', 'Explore an example first')}<ArrowUpRight size={18} /></button></div><section className="setup-panel"><p className="eyebrow">{t('Paso 1 · tu hogar', 'Step 1 · your household')}</p><h2>{t('Empecemos por lo simple', 'Start with the basics')}</h2><HouseholdForm onDone={() => navigate('home')} /></section></div> : page === 'home' ? <Overview /> : page === 'reserve' ? <Reserves /> : page === 'plan' ? <Planner /> : page === 'incidents' ? <Incidents /> : page === 'tasks' ? <Tasks /> : page === 'settings' ? <Settings /> : <Lab />}
        </main>
        <footer className="app-footer"><span>Asu · {t('Hecho para organizar, no para prometer.', 'Built to help you plan, not to make promises.')}</span><a href="#lab">{t('Fuentes y límites', 'Sources & limitations')}</a></footer>
      </div>
      <nav className="mobile-nav" aria-label={t('Navegación móvil', 'Mobile navigation')}>{nav.map(item => <a key={item.id} href={`#${item.id}`} aria-current={page === item.id ? 'page' : undefined}><item.icon size={21} /><span>{item.label}</span></a>)}</nav>
    </div>
    {notice && <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.text}</span><button className="icon-button" aria-label={t('Cerrar notificación', 'Dismiss notification')} onClick={() => setNotice(null)}>×</button></div>}
  </Context.Provider>;
}
