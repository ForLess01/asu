import { useId, useState, type FormEvent } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { activitySchema, revise, saveContainer, startIncident, restoreIncident, validateContainer, validateIncident, type Container, type Activity, type Incident } from '../../../packages/domain/src/index';
import { useAsu } from './context';
import { FormError } from './components';
import { fromLimaInput, inputTime } from './i18n';

export function HouseholdForm({ onDone }: { onDone?: () => void }) {
  const { state, commit, t, busy } = useAsu();
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try {
      const next = revise(state, draft => { draft.household = {
        label: String(form.get('label')).trim(), district: String(form.get('district')).trim(),
        department: String(form.get('department')).trim().toUpperCase(), eps: String(form.get('eps')).trim().toUpperCase(), occupancy: Number(form.get('occupancy')),
      }; });
      if (await commit(next)) onDone?.();
    } catch { setError(t('Revisa los datos del hogar. Personas: entre 1 y 500.', 'Check your household details. Occupancy must be between 1 and 500.')); }
  };
  return <form onSubmit={submit}><fieldset disabled={busy}>
    <label>{t('Nombre del hogar', 'Household name')}<input name="label" required maxLength={80} defaultValue={state.household?.label ?? ''} placeholder={t('Mi hogar', 'My household')} autoComplete="off" /></label>
    <div className="form-grid"><label>{t('Distrito', 'District')}<input name="district" required maxLength={100} defaultValue={state.household?.district ?? ''} placeholder="Pueblo Libre" /></label>
      <label>{t('Departamento', 'Department')}<input name="department" list="departments" required maxLength={100} defaultValue={state.household?.department ?? 'LIMA'} /><datalist id="departments"><option value="LIMA" /><option value="AREQUIPA" /><option value="LA LIBERTAD" /><option value="PIURA" /></datalist></label></div>
    <div className="form-grid"><label>{t('Empresa de agua (EPS)', 'Water utility (EPS)')}<input name="eps" list="utilities" required maxLength={100} defaultValue={state.household?.eps ?? 'SEDAPAL'} /><datalist id="utilities"><option value="SEDAPAL" /><option value="SEDAPAR" /><option value="SEDALIB" /></datalist></label>
      <label>{t('Personas en casa', 'People at home')}<input name="occupancy" type="number" min="1" max="500" required defaultValue={state.household?.occupancy ?? 4} /></label></div>
    <p className="hint">{t('Confirma tu distrito y EPS. No verificamos cobertura de tu vivienda ni pedimos tu dirección exacta.', 'Confirm your district and utility. We do not verify your home’s service coverage or ask for your exact address.')}</p>
    <FormError message={error} /><button className="primary" type="submit">{state.household ? t('Guardar hogar', 'Save household') : t('Crear mi plan local', 'Create my local plan')}<ArrowRight size={18} /></button>
    {!state.household && <p className="privacy-note"><ShieldCheck size={17} />{t('Sin cuenta. Tus datos se guardan en este dispositivo.', 'No account needed. Your data stays on this device.')}</p>}
  </fieldset></form>;
}

export function ContainerForm({ container, onDone }: { container?: Container; onDone: () => void }) {
  const { state, commit, t, busy } = useAsu();
  const [error, setError] = useState('');
  const feedbackId = useId();
  const [unknownVolume, setUnknownVolume] = useState(container?.volume === null);
  const [unknownCapacity, setUnknownCapacity] = useState(container?.capacity === null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const capacity = unknownCapacity ? null : Number(form.get('capacity')), volume = unknownVolume ? null : Number(form.get('volume'));
    if (!validateContainer({ capacity, volume })) { setError(t('El volumen debe estar entre 0 y la capacidad; la capacidad debe ser mayor que 0.', 'Volume must be between 0 and capacity; capacity must be greater than 0.')); return; }
    try {
      const next = saveContainer(state, { id: container?.id ?? crypto.randomUUID(), name: String(form.get('name')).trim(), capacity, volume, category: form.get('category') as Container['category'], observedAt: new Date().toISOString() });
      if (await commit(next)) onDone();
    } catch { setError(t('Revisa el nombre y las cantidades.', 'Check the name and amounts.')); }
  };
  return <form onSubmit={submit}><fieldset disabled={busy}>
    <label>{t('Nombre del recipiente', 'Container name')}<input name="name" defaultValue={container?.name} placeholder={t('Ej. Tanque del patio', 'e.g. Patio tank')} required maxLength={80} autoFocus /></label>
    <label>{t('Uso del agua', 'Water use')}<select name="category" defaultValue={container?.category ?? 'other'}><option value="drinking">{t('Bebida y cocina', 'Drinking & cooking')}</option><option value="other">{t('Otros usos (no transferir a bebida)', 'Other uses (never transfer to drinking)')}</option></select></label>
    <p className="hint">{t('La categoría es tu declaración de uso; Asu no certifica potabilidad.', 'The category records your intended use; Asu does not certify potability.')}</p>
    <div className="form-grid"><div><label>{t('Capacidad (L)', 'Capacity (L)')}<input name="capacity" type="number" min="0.01" step="any" defaultValue={container?.capacity ?? ''} required={!unknownCapacity} disabled={unknownCapacity} aria-invalid={!!error} aria-describedby={error ? feedbackId : undefined} /></label><label className="check"><input type="checkbox" checked={unknownCapacity} onChange={e => setUnknownCapacity(e.target.checked)} />{t('No conozco la capacidad', 'Capacity unknown')}</label></div>
      <div><label>{t('Agua disponible (L)', 'Available water (L)')}<input name="volume" type="number" min="0" step="any" defaultValue={container?.volume ?? ''} required={!unknownVolume} disabled={unknownVolume} aria-invalid={!!error} aria-describedby={error ? feedbackId : undefined} onBlur={e => { if (!unknownCapacity && e.currentTarget.form) { const f = new FormData(e.currentTarget.form); if (Number(e.target.value) > Number(f.get('capacity'))) setError(t('El volumen supera la capacidad.', 'Volume exceeds capacity.')); else setError(''); } }} /></label><label className="check"><input type="checkbox" checked={unknownVolume} onChange={e => setUnknownVolume(e.target.checked)} />{t('Todavía no lo sé', 'Not measured yet')}</label></div></div>
    <p className="hint">{t('1 m³ = 1.000 L · 1.000 ml = 1 L. Al guardar registras una medición de ahora, no una reposición automática.', '1 m³ = 1,000 L · 1,000 ml = 1 L. Saving records a measurement now, not an automatic replenishment.')}</p>
    <FormError message={error} id={feedbackId} reserveSpace /><button type="submit" className="primary">{t('Guardar recipiente', 'Save container')}</button>
  </fieldset></form>;
}

export function ActivityForm({ activity, onDone }: { activity?: Activity; onDone: () => void }) {
  const { state, commit, t, busy } = useAsu(); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try {
      const value = activitySchema.parse({ id: activity?.id ?? crypto.randomUUID(), name: String(form.get('name')), category: form.get('category'), liters: Number(form.get('liters')), timesPerDay: Number(form.get('frequency')), essential: form.get('essential') === 'on', source: String(form.get('source')), updatedAt: new Date().toISOString() });
      const next = revise(state, draft => { const i = draft.activities.findIndex(a => a.id === value.id); if (i < 0) draft.activities.push(value); else draft.activities[i] = value; });
      if (await commit(next)) onDone();
    } catch { setError(t('Revisa los litros, la frecuencia y la fuente del supuesto.', 'Check liters, frequency, and the assumption source.')); }
  };
  return <form onSubmit={submit}><fieldset disabled={busy}>
    <label>{t('Actividad', 'Activity')}<input name="name" required maxLength={80} defaultValue={activity?.name} placeholder={t('Ej. Lavar ropa', 'e.g. Laundry')} autoFocus /></label>
    <label>{t('Uso del agua', 'Water use')}<select name="category" defaultValue={activity?.category ?? 'other'}><option value="drinking">{t('Bebida y cocina', 'Drinking & cooking')}</option><option value="other">{t('Otros usos', 'Other uses')}</option></select></label>
    <div className="form-grid"><label>{t('Litros por vez (todo el hogar)', 'Liters per use (whole household)')}<input name="liters" type="number" min="0" step="any" required defaultValue={activity?.liters} /></label><label>{t('Veces al día', 'Times per day')}<input name="frequency" type="number" min="0.001" max="1000" step="any" required defaultValue={activity?.timesPerDay ?? 1} /></label></div>
    <label className="check"><input name="essential" type="checkbox" defaultChecked={activity?.essential ?? true} />{t('Esencial: no posponer en escenarios', 'Essential: cannot be deferred in scenarios')}</label>
    <label>{t('Fuente o supuesto', 'Source or assumption')}<input name="source" required maxLength={160} defaultValue={activity?.source === 'example' ? t('Ejemplo, no una recomendación sanitaria', 'Example, not health guidance') : activity?.source ?? t('Estimación propia, no medida', 'Own estimate, not measured')} /></label>
    <p className="hint">{t('Consumo horario constante supuesto = litros × veces al día ÷ 24. No se multiplica de nuevo por personas. No es una recomendación médica.', 'Assumed constant hourly demand = liters × times per day ÷ 24. It is not multiplied by occupancy again. This is not medical advice.')}</p>
    <FormError message={error} /><button type="submit" className="primary">{t('Guardar actividad', 'Save activity')}</button>
  </fieldset></form>;
}

export function IncidentForm({ incident, onDone, correction = false }: { incident?: Incident; onDone: () => void; correction?: boolean }) {
  const { state, commit, t, busy } = useAsu(); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try {
      const time = fromLimaInput(String(form.get('time')));
      if (!validateIncident(incident?.startedAt ?? time, incident ? time : undefined)) throw new Error('invalid-time');
      let next;
      if (incident) {
        next = restoreIncident(state, incident.id, time, form.get('precision') as 'exact' | 'approximate');
        if (correction) next = revise(next, draft => { draft.incidents.find(i => i.id === incident.id)!.updates.push({ at: new Date().toISOString(), note: `${incident.restoredAt} → ${time}: ${String(form.get('reason')).trim()}` }); });
      } else next = startIncident(state, { id: crypto.randomUUID(), startedAt: time, restoredAt: null, source: String(form.get('source')).trim(), scope: 'household', precision: form.get('precision') as 'exact' | 'approximate', updates: [] });
      if (await commit(next)) onDone();
    } catch { setError(t('La hora debe ser válida, no futura y el retorno no puede ser anterior al inicio.', 'Use a valid, non-future time. Restoration cannot be before the start.')); }
  };
  return <form onSubmit={submit}><fieldset disabled={busy}>
    <p className="hint">{t('Reporte de tu vivienda. No es un aviso oficial ni cierra un evento de la EPS.', 'A report for your home. This is not an official notice and does not close a utility event.')}</p>
    <label>{incident ? t('Retorno observado · hora de Lima', 'Observed restoration · Lima time') : t('Inicio del corte · hora de Lima', 'Outage start · Lima time')}<input name="time" type="datetime-local" required max={inputTime()} defaultValue={inputTime(incident?.restoredAt ?? undefined)} /></label>
    <label>{t('Precisión de la hora', 'Time precision')}<select name="precision" defaultValue="approximate"><option value="approximate">{t('Aproximada', 'Approximate')}</option><option value="exact">{t('Exacta', 'Exact')}</option></select></label>
    {!incident && <label>{t('Fuente de la información', 'Information source')}<input name="source" required maxLength={160} defaultValue={t('Observación propia en mi vivienda', 'Own observation at my home')} /></label>}
    {correction && <label>{t('Motivo de la corrección', 'Reason for correction')}<input name="reason" required minLength={3} maxLength={120} /></label>}
    <FormError message={error} /><button type="submit" className="primary">{incident ? t('Confirmar retorno observado', 'Confirm observed restoration') : t('Registrar corte', 'Record outage')}</button>
  </fieldset></form>;
}
