import { useId, useState, type FormEvent } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { activitySchema, revise, saveContainer, startIncident, restoreIncident, validateContainer, validateIncident, type Container, type Activity, type Incident } from '../../../packages/domain/src/index';
import { useAsu } from './context';
import { FormError } from './components';
import { fromLimaInput, inputTime } from './i18n';
import { OptionInput } from './OptionInput';
import { departments, utilities, districtOptions, matchOption } from './form-options';

export function HouseholdForm({ onDone }: { onDone?: () => void }) {
  const { state, commit, t, busy, account, mode } = useAsu();
  const [error, setError] = useState('');
  const [department, setDepartment] = useState(state.household?.department ?? 'LIMA');
  const [district, setDistrict] = useState(state.household?.district ?? '');
  const [eps, setEps] = useState(state.household?.eps ?? 'SEDAPAL');
  const [customDistrict, setCustomDistrict] = useState(!!state.household && !matchOption(state.household.district, districtOptions(department)));
  const [customEps, setCustomEps] = useState(!!state.household && !utilities.includes(state.household.eps));
  const districtChoices = districtOptions(department), utilityChoices = utilities.map(value => ({ value }));
  const inAccount = mode !== 'example' && !!account.identity;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try {
      if (!departments.includes(department) || (!customDistrict && !matchOption(district, districtChoices)) || (!customEps && !matchOption(eps, utilityChoices))) throw new Error('invalid-catalog-choice');
      const next = revise(state, draft => { draft.household = {
        label: String(form.get('label')).trim(), district: (customDistrict ? district : matchOption(district, districtChoices)!.value).trim(),
        department, eps: eps.trim().toUpperCase(), occupancy: Number(form.get('occupancy')),
      }; });
      if (await commit(next)) onDone?.();
    } catch { setError(t('Revisa las opciones del hogar y completa los campos. Personas: entre 1 y 500.', 'Review the household options and complete the fields. Occupancy must be between 1 and 500.')); }
  };
  return <form onSubmit={submit}><fieldset disabled={busy}>
    <p className="hint">{t('Todos los campos son obligatorios. Puedes elegir de la lista; Tab completa una coincidencia única después de escribir.', 'All fields are required. Choose from the list; Tab completes a unique match after you type.')}</p>
    <label>{t('Nombre del hogar', 'Household name')}<input name="label" required maxLength={80} defaultValue={state.household?.label ?? ''} placeholder={t('Mi hogar', 'My household')} autoComplete="off" /></label>
    <label>{t('Departamento', 'Department')}<select aria-label={t('Departamento', 'Department')} name="department" value={department} required onChange={event => { setDepartment(event.target.value); setDistrict(''); setEps(''); setCustomDistrict(false); setCustomEps(false); setError(''); }}><option value="">{t('Selecciona un departamento', 'Select a department')}</option>{departments.map(value => <option key={value}>{value}</option>)}</select></label>
    <OptionInput key={`${department}-${customDistrict}`} name="district" label={t('Distrito', 'District')} value={district} onChange={setDistrict} options={districtChoices} restricted={!customDistrict} placeholder={t('Escribe para buscar un distrito', 'Type to find a district')} />
    <label className="check"><input type="checkbox" checked={customDistrict} onChange={event => setCustomDistrict(event.target.checked)} />{t('Mi distrito no figura en el catálogo', 'My district is not listed')}</label>
    <div className="form-grid"><div><OptionInput key={`eps-${customEps}`} name="eps" label={t('Empresa de agua (EPS)', 'Water utility (EPS)')} value={eps} onChange={setEps} options={utilityChoices} restricted={!customEps} placeholder={t('Busca tu prestadora', 'Find your utility')} /><label className="check"><input type="checkbox" checked={customEps} onChange={event => setCustomEps(event.target.checked)} />{t('Mi prestadora no figura en la lista', 'My utility is not listed')}</label></div>
      <label>{t('Personas en casa', 'People at home')}<input name="occupancy" type="number" min="1" max="500" required defaultValue={state.household?.occupancy ?? 4} /></label></div>
    <p className="hint">{t('Catálogo geográfico de referencia 2021 y prestadoras del registro histórico SUNASS. No certifica cobertura ni límites vigentes; usa “no figura” si falta tu opción. No pedimos dirección exacta.', 'Reference geography catalog from 2021 and utilities from the historical SUNASS register. This does not certify current boundaries or service coverage; use “not listed” if needed. No exact address is requested.')}</p>
    <FormError message={error} /><button className="primary" type="submit">{state.household ? t('Guardar hogar', 'Save household') : inAccount ? t('Crear mi plan', 'Create my plan') : t('Crear mi plan local', 'Create my local plan')}<ArrowRight size={18} /></button>
    {!state.household && <p className="privacy-note"><ShieldCheck size={17} />{inAccount ? t('Tu cuenta guardará el plan automáticamente en Neon.', 'Your account will save the plan automatically in Neon.') : t('Sin cuenta. Tus datos se guardan en este dispositivo.', 'No account needed. Your data stays on this device.')}</p>}
  </fieldset></form>;
}

export function ContainerForm({ container, onDone }: { container?: Container; onDone: () => void }) {
  const { state, commit, t, busy } = useAsu();
  const [error, setError] = useState('');
  const feedbackId = useId();
  const [unknownVolume, setUnknownVolume] = useState(container?.volume === null);
  const [unknownCapacity, setUnknownCapacity] = useState(container?.capacity === null);
  const [name, setName] = useState(container?.name ?? '');
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
    <OptionInput name="name" label={t('Nombre del recipiente', 'Container name')} value={name} onChange={setName} maxLength={80} autoFocus placeholder={t('Ej. Tanque del patio', 'e.g. Patio tank')} options={[t('Tanque principal', 'Main tank'), t('Cisterna', 'Cistern'), t('Bidón de cocina', 'Kitchen container'), t('Balde de reserva', 'Reserve bucket')].map(value => ({ value }))} />
    <label>{t('Uso del agua', 'Water use')}<select aria-label={t('Uso del agua', 'Water use')} name="category" defaultValue={container?.category ?? 'other'}><option value="drinking">{t('Bebida y cocina', 'Drinking & cooking')}</option><option value="other">{t('Otros usos (no transferir a bebida)', 'Other uses (never transfer to drinking)')}</option></select></label>
    <p className="hint">{t('La categoría es tu declaración de uso; Asu no certifica potabilidad.', 'The category records your intended use; Asu does not certify potability.')}</p>
    <div className="form-grid"><div><label>{t('Capacidad (L)', 'Capacity (L)')}<input name="capacity" type="number" min="0.01" step="any" defaultValue={container?.capacity ?? ''} required={!unknownCapacity} disabled={unknownCapacity} aria-invalid={!!error} aria-describedby={error ? feedbackId : undefined} /></label><label className="check"><input type="checkbox" checked={unknownCapacity} onChange={e => setUnknownCapacity(e.target.checked)} />{t('No conozco la capacidad', 'Capacity unknown')}</label></div>
      <div><label>{t('Agua disponible (L)', 'Available water (L)')}<input name="volume" type="number" min="0" step="any" defaultValue={container?.volume ?? ''} required={!unknownVolume} disabled={unknownVolume} aria-invalid={!!error} aria-describedby={error ? feedbackId : undefined} onBlur={e => { if (!unknownCapacity && e.currentTarget.form) { const f = new FormData(e.currentTarget.form); if (Number(e.target.value) > Number(f.get('capacity'))) setError(t('El volumen supera la capacidad.', 'Volume exceeds capacity.')); else setError(''); } }} /></label><label className="check"><input type="checkbox" checked={unknownVolume} onChange={e => setUnknownVolume(e.target.checked)} />{t('Todavía no lo sé', 'Not measured yet')}</label></div></div>
    <p className="hint">{t('1 m³ = 1.000 L · 1.000 ml = 1 L. Al guardar registras una medición de ahora, no una reposición automática.', '1 m³ = 1,000 L · 1,000 ml = 1 L. Saving records a measurement now, not an automatic replenishment.')}</p>
    <FormError message={error} id={feedbackId} reserveSpace /><button type="submit" className="primary">{t('Guardar recipiente', 'Save container')}</button>
  </fieldset></form>;
}

export function ActivityForm({ activity, onDone }: { activity?: Activity; onDone: () => void }) {
  const { state, commit, t, busy } = useAsu(); const [error, setError] = useState('');
  const [name, setName] = useState(activity?.name ?? '');
  const sourceChoices = [t('Estimación propia, no medida', 'Own estimate, not measured'), t('Medición propia', 'Own measurement'), t('Registro de un medidor', 'Meter reading'), t('Ejemplo, no una recomendación sanitaria', 'Example, not health guidance')];
  const initialSource = activity?.source === 'example' ? sourceChoices[3] : activity?.source ?? sourceChoices[0];
  const [source, setSource] = useState(initialSource), [customSource, setCustomSource] = useState(!sourceChoices.includes(initialSource));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try {
      const value = activitySchema.parse({ id: activity?.id ?? crypto.randomUUID(), name: String(form.get('name')), category: form.get('category'), liters: Number(form.get('liters')), timesPerDay: Number(form.get('frequency')), essential: form.get('essential') === 'on', source: String(form.get('source')), updatedAt: new Date().toISOString() });
      const next = revise(state, draft => { const i = draft.activities.findIndex(a => a.id === value.id); if (i < 0) draft.activities.push(value); else draft.activities[i] = value; });
      if (await commit(next)) onDone();
    } catch { setError(t('Revisa los litros, la frecuencia y la fuente del supuesto.', 'Check liters, frequency, and the assumption source.')); }
  };
  return <form onSubmit={submit}><fieldset disabled={busy}>
    <OptionInput name="name" label={t('Actividad', 'Activity')} value={name} onChange={setName} maxLength={80} autoFocus placeholder={t('Ej. Lavar ropa', 'e.g. Laundry')} options={[t('Bebida y cocina', 'Drinking and cooking'), t('Lavado de ropa', 'Laundry'), t('Higiene personal', 'Personal hygiene'), t('Limpieza del hogar', 'Household cleaning')].map(value => ({ value }))} />
    <label>{t('Uso del agua', 'Water use')}<select name="category" defaultValue={activity?.category ?? 'other'}><option value="drinking">{t('Bebida y cocina', 'Drinking & cooking')}</option><option value="other">{t('Otros usos', 'Other uses')}</option></select></label>
    <div className="form-grid"><label>{t('Litros por vez (todo el hogar)', 'Liters per use (whole household)')}<input name="liters" type="number" min="0" step="any" required defaultValue={activity?.liters} /></label><label>{t('Veces al día', 'Times per day')}<input name="frequency" type="number" min="0.001" max="1000" step="any" required defaultValue={activity?.timesPerDay ?? 1} /></label></div>
    <label className="check"><input name="essential" type="checkbox" defaultChecked={activity?.essential ?? true} />{t('Esencial: no posponer en escenarios', 'Essential: cannot be deferred in scenarios')}</label>
    <label>{t('Fuente o supuesto', 'Source or assumption')}<select name={customSource ? 'source-choice' : 'source'} value={customSource ? '__custom__' : source} onChange={event => { const custom = event.target.value === '__custom__'; setCustomSource(custom); setSource(custom ? '' : event.target.value); }}>{sourceChoices.map(value => <option key={value}>{value}</option>)}<option value="__custom__">{t('Otra fuente: especificar', 'Other source: specify')}</option></select></label>
    {customSource && <label>{t('Detalle de la fuente', 'Source details')}<input name="source" required maxLength={160} value={source} onChange={event => setSource(event.target.value)} /></label>}
    <p className="hint">{t('Consumo horario constante supuesto = litros × veces al día ÷ 24. No se multiplica de nuevo por personas. No es una recomendación médica.', 'Assumed constant hourly demand = liters × times per day ÷ 24. It is not multiplied by occupancy again. This is not medical advice.')}</p>
    <FormError message={error} /><button type="submit" className="primary">{t('Guardar actividad', 'Save activity')}</button>
  </fieldset></form>;
}

export function IncidentForm({ incident, onDone, correction = false }: { incident?: Incident; onDone: () => void; correction?: boolean }) {
  const { state, commit, t, busy } = useAsu(); const [error, setError] = useState('');
  const sources = [t('Observación propia en mi vivienda', 'Own observation at my home'), t('Aviso de mi prestadora (EPS)', 'Notice from my utility'), t('Comunicado de mi edificio', 'Building notice'), t('Reporte de otra persona, sin verificar', 'Unverified report from another person')];
  const [source, setSource] = useState(sources[0]), [customSource, setCustomSource] = useState(false);
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
    {!incident && <><label>{t('Fuente de la información', 'Information source')}<select name={customSource ? 'source-choice' : 'source'} value={customSource ? '__custom__' : source} onChange={event => { const custom = event.target.value === '__custom__'; setCustomSource(custom); setSource(custom ? '' : event.target.value); }}>{sources.map(value => <option key={value}>{value}</option>)}<option value="__custom__">{t('Otra fuente: especificar', 'Other source: specify')}</option></select></label>{customSource && <label>{t('Detalle de la fuente', 'Source details')}<input name="source" required maxLength={160} value={source} onChange={event => setSource(event.target.value)} /></label>}</>}
    {correction && <label>{t('Motivo de la corrección', 'Reason for correction')}<input name="reason" required minLength={3} maxLength={120} /></label>}
    <FormError message={error} /><button type="submit" className="primary">{incident ? t('Confirmar retorno observado', 'Confirm observed restoration') : t('Registrar corte', 'Record outage')}</button>
  </fieldset></form>;
}
