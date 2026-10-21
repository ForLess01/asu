import { useId, useState } from 'react';
import { completeOption, matchOption, type FormOption } from './form-options';
import { useAsu } from './context';

/** Native suggestions retain standard keyboard/mobile behavior; restricted fields validate membership. */
export function OptionInput({ label, name, value, onChange, options, restricted = false, required = true, placeholder, autoFocus = false, maxLength = 100 }: {
  label: string; name: string; value: string; onChange: (value: string) => void;
  options: FormOption[]; restricted?: boolean; required?: boolean; placeholder?: string; autoFocus?: boolean; maxLength?: number;
}) {
  const id = useId(), { t } = useAsu(), [error, setError] = useState('');
  return <div><label htmlFor={`${id}-input`}>{label}<input id={`${id}-input`} name={name} value={value} list={`${id}-options`} required={required} maxLength={maxLength} autoFocus={autoFocus}
    autoComplete="off" placeholder={placeholder} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
    onChange={event => { event.currentTarget.setCustomValidity(''); setError(''); onChange(event.target.value); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const suggestion = completeOption(event.currentTarget.value, options);
      if (suggestion) { event.currentTarget.value = suggestion.value; onChange(suggestion.value); }
    }}
    onBlur={event => {
      const selected = matchOption(event.currentTarget.value, options);
      if (selected) { onChange(selected.value); event.currentTarget.setCustomValidity(''); setError(''); }
      else if (restricted && event.currentTarget.value.trim()) {
        const message = t('Selecciona una opción de la lista o indica que no figura en el catálogo.', 'Select an option from the list or indicate that it is not listed.');
        event.currentTarget.setCustomValidity(message); setError(message);
      }
    }} /></label>
    <datalist id={`${id}-options`}>{options.map(option => <option key={option.value} value={option.value}>{option.label ?? option.value}</option>)}</datalist>
    {error && <span id={`${id}-error`} className="field-error" role="alert">{error}</span>}
  </div>;
}
