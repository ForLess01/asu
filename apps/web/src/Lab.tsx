import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FlaskConical, AlertTriangle, RotateCw, ExternalLink } from 'lucide-react';
import type { BundleEvidence, PortableModel } from '../../../packages/inference/src/index';
import { useAsu } from './context';
import { PageHeading } from './components';
import { formatNumber, fromLimaInput } from './i18n';

export function Lab() {
  const { state, t, online } = useAsu();
  const worker = useRef<Worker | null>(null), sequence = useRef(0);
  const [model, setModel] = useState<PortableModel | null>(null), [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0), [result, setResult] = useState<number[] | null>(null), [error, setError] = useState(''), [running, setRunning] = useState(false);
  const [metrics, setMetrics] = useState<unknown>(null);
  const [evidence, setEvidence] = useState<BundleEvidence | null>(null);
  useEffect(() => {
    setStatus('loading'); setModel(null); setResult(null); setMetrics(null); setEvidence(null); setError('');
    const instance = new Worker(new URL('./model.worker.ts', import.meta.url), { type: 'module' }); worker.current = instance;
    let active = true, failed = false;
    const fail = () => { failed = true; instance.terminate(); setStatus('error'); setModel(null); setMetrics(null); setEvidence(null); setResult(null); setRunning(false); };
    const timeout = setTimeout(fail, 20000);
    instance.onmessage = event => {
      if (!active || failed) return;
      const message = event.data;
      if (message.type === 'ready') { clearTimeout(timeout); setModel(message.model); setMetrics(message.metrics); setEvidence(message.evidence); setStatus('ready'); }
      if (message.type === 'prediction') { setResult(message.values); setRunning(false); }
      if (message.type === 'error') { clearTimeout(timeout); if (message.id === 0) fail(); else { setError('unsupported'); setRunning(false); } }
    };
    instance.onerror = () => { if (active) { clearTimeout(timeout); fail(); } };
    instance.postMessage({ type: 'load', id: 0 });
    return () => { active = false; clearTimeout(timeout); instance.terminate(); worker.current = null; };
  }, [retry]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setResult(null); setError('');
    if (!model || !worker.current) return;
    const form = new FormData(event.currentTarget);
    try {
      const startedAt = fromLimaInput(String(form.get('start')));
      const date = String(form.get('start')).slice(0, 10);
      if (date > model.data_cutoff || Date.parse(startedAt) > Date.now()) { setError('historical'); return; }
      if (Number(form.get('elapsed')) !== 0) { setError('residual'); return; }
      setRunning(true);
      worker.current.postMessage({ id: ++sequence.current, type: 'predict', eps: form.get('eps'), department: form.get('department'), startedAt });
    } catch { setError('time'); }
  };
  return <><PageHeading eyebrow={t('Investigación separada de tu plan', 'Research separate from your plan')} title={t('Laboratorio de duración reportada', 'Reported-duration laboratory')} description={t('Explora un modelo histórico. No predice cuándo volverá el agua a tu casa.', 'Explore a historical model. It does not predict when water will return to your home.')} />
    <div className="lab-warning"><FlaskConical size={26} /><div><strong>{t('Experimental · semántica de etiqueta no aprobada', 'Experimental · label semantics not approved')}</strong><p>{t('SUNASS no ha permitido verificar aquí si el fin reportado es previsto o real. label_semantics_approved = false. No ofrecemos garantías de retorno real ni una cuenta regresiva.', 'The reported end has not been verified here as planned or actual restoration. label_semantics_approved = false. We offer no actual-return guarantees or countdown.')}</p></div></div>
    <section className="panel model-panel"><div className="section-heading"><h2>{t('Modelo local en Web Worker', 'Local model in a Web Worker')}</h2><span className="badge" data-testid="model-status">{status === 'loading' ? t('Cargando…', 'Loading…') : status === 'ready' ? t('Listo · experimental', 'Ready · experimental') : t('No disponible', 'Unavailable')}</span></div>
      {status === 'loading' && <p aria-busy="true">{t('Verificando modelo, métricas y huellas del mismo paquete. Tu plan manual sigue disponible.', 'Verifying the model, metrics, and checksums as one bundle. Your manual plan remains available.')}</p>}
      {status === 'error' && <><p>{t('No se pudo verificar un paquete coherente de modelo y métricas. Puede faltar un archivo, haber una huella distinta, una actualización en curso o no haber conexión. No mostramos evidencia mezclada ni cifras sustitutas.', 'A coherent model and metrics bundle could not be verified. A file may be missing, checksums may differ, an update may be in progress, or the connection may be unavailable. We do not show mixed evidence or substitute values.')}</p><button onClick={() => setRetry(r => r + 1)}><RotateCw size={18} />{t('Reintentar carga', 'Retry loading')}</button></>}
      {model && <><dl className="model-metadata"><div><dt>{t('Versión', 'Version')}</dt><dd>{model.model_version}</dd></div><div><dt>{t('Corte de datos (histórico)', 'Historical data cutoff')}</dt><dd>{model.data_cutoff}</dd></div><div><dt>{t('Objetivo', 'Target')}</dt><dd>{t('Duración reportada, no retorno real', 'Reported duration, not actual restoration')}</dd></div><div><dt>{t('Fuente', 'Source')}</dt><dd>SUNASS · ODC-BY</dd></div></dl><details><summary>{t('Huella de fuente y alcance', 'Source fingerprint & scope')}</summary><p className="code-wrap">SHA-256: {model.source_sha256}</p><p className="code-wrap">target_semantics: {model.target_semantics}</p><p>{model.support.eps_codes.join(', ')}</p><p>{model.support.departments.join(', ')}</p></details>
        <form className="lab-form" onSubmit={submit}><fieldset disabled={running}><h3>{t('Consulta histórica al inicio del evento', 'Historical query at event start')}</h3><p className="hint">{t('No uses este resultado como aviso de un corte actual. Las categorías y la fecha de ejemplo se leen del artefacto; esta consulta es retrospectiva.', 'Do not use this result as a current outage notice. Categories and the example date come from the artifact; this query is retrospective.')}</p><div className="form-grid"><label>EPS<select name="eps" defaultValue={model.preprocessing.categories.eps.includes(state.household?.eps ?? 'SEDAPAL') ? state.household?.eps ?? 'SEDAPAL' : model.preprocessing.categories.eps[0]}>{model.preprocessing.categories.eps.map(value => <option key={value}>{value}</option>)}</select></label><label>{t('Departamento', 'Department')}<select name="department" defaultValue={model.preprocessing.categories.department.includes(state.household?.department ?? 'LIMA') ? state.household?.department ?? 'LIMA' : model.preprocessing.categories.department[0]}>{model.preprocessing.categories.department.map(value => <option key={value}>{value}</option>)}</select></label></div><div className="form-grid"><label>{t('Inicio histórico · Lima', 'Historical start · Lima')}<input name="start" type="datetime-local" required defaultValue={`${model.data_cutoff}T09:00`} /></label><label>{t('Horas transcurridas', 'Elapsed hours')}<input name="elapsed" type="number" min="0" required defaultValue="0" step="any" /></label></div>
          <p className="hint">{t('Solo duración total al inicio. Nunca restamos horas transcurridas a los cuantiles iniciales. No existe un modelo residual validado.', 'Total duration at the start only. We never subtract elapsed hours from initial quantiles. There is no validated residual model.')}</p>
          <button className="primary" type="submit" disabled={running}>{running ? t('Calculando…', 'Computing…') : t('Ejecutar modelo histórico', 'Run historical model')}</button></fieldset></form>
      </>}
      {error && <p className="form-error" role="alert">{error === 'historical' ? t('Fecha fuera del alcance histórico. No extrapolamos este modelo a cortes actuales.', 'Date outside historical scope. We do not extrapolate this model to current outages.') : error === 'residual' ? t('Sin modelo residual validado: no podemos dar tiempo restante. Usa 0 para explorar la duración inicial histórica.', 'No validated residual model: remaining time is unavailable. Use 0 to explore historical initial duration.') : t('Tiempo o categoría no compatible. No se generó predicción.', 'Unsupported time or category. No prediction was generated.')}</p>}
      {result && <div className="prediction-result" role="status" data-testid="prediction-result"><span className="eyebrow">{t('Duración total reportada · no retorno real', 'Total reported duration · not actual restoration')}</span><h2>{formatNumber(result[0], state.locale)}–{formatNumber(result[2], state.locale)} h</h2><p>{t('Mediana histórica estimada', 'Estimated historical median')}: {formatNumber(result[1], state.locale)} h · p10 / p50 / p90</p><p>{t('Intervalo experimental calibrado, no una garantía. No modifica tus incidentes ni tu reserva.', 'Experimental calibrated interval, not a guarantee. It does not change your incidents or reserve.')}</p></div>}
    </section>
    <section className="panel"><h2>{t('Evidencia del artefacto', 'Artifact evidence')}</h2><p>{t('Métricas cargadas del archivo publicado, sin cifras sustitutas. El test de 2024 fue reutilizado: es exploratorio, no validación final independiente.', 'Metrics loaded from the published file, without substitute numbers. The 2024 test was reused: it is exploratory, not independent final validation.')}</p>{evidence && <details><summary>{t('Vinculación verificada del paquete', 'Verified bundle binding')}</summary><p data-testid="bundle-verification">{evidence.model_version} · {evidence.run_id}</p><p className="code-wrap">checksums SHA-256: {evidence.checksums_sha256}</p><p className="code-wrap">model SHA-256: {evidence.model_sha256}</p><p className="code-wrap">metrics SHA-256: {evidence.metrics_sha256}</p><p className="code-wrap">source SHA-256: {evidence.source_sha256}</p></details>}{metrics ? <details><summary>{t('Ver métricas y límites publicados', 'View published metrics & limitations')}</summary><pre className="metrics-json">{JSON.stringify(metrics, null, 2)}</pre></details> : <p className="hint">{t('Métricas no disponibles en esta carga.', 'Metrics unavailable in this session.')}</p>}<div className="button-row"><a className="button" href="/models/current/model-card.md" target="_blank" rel="noreferrer">{t('Ficha del modelo', 'Model card')}<ExternalLink size={16} /></a><a className="button" href="https://aplicaciones.sunass.gob.pe/Interrupciones/buscarInterrupcion.html" target="_blank" rel="noreferrer">SUNASS<ExternalLink size={16} /></a></div><p className="source-note"><AlertTriangle size={18} />{online ? t('Fuente histórica, no una actualización de interrupciones en vivo.', 'Historical source, not a live outage update.') : t('Sin conexión: los recursos del modelo pueden no estar disponibles.', 'Offline: model resources may be unavailable.')}</p></section>
  </>;
}
