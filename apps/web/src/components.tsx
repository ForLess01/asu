import { useEffect, useRef, type PropsWithChildren, type ReactNode } from 'react';
import { X, Plus, ArrowRight } from 'lucide-react';
import { useAsu } from './context';
import { formatNumber } from './i18n';

export function Modal({ title, onClose, children }: PropsWithChildren<{ title: string; onClose: () => void }>) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t, mode } = useAsu();
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={onClose} className="modal" aria-label={title}>
    <div className="modal-head"><h2>{title}</h2><button type="button" className="icon-button" aria-label={t('Cerrar', 'Close')} onClick={onClose}><X size={22} /></button></div>
    {mode === 'example' && <p className="modal-demo-note">{t('Datos de ejemplo · separados de tu hogar', 'Example data · separate from your household')}</p>}
    {children}
  </dialog>;
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1 tabIndex={-1} id="page-title">{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action}</header>;
}
export function Empty({ title, children, action }: PropsWithChildren<{ title: string; action?: ReactNode }>) {
  return <div className="empty"><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function AddButton({ children, onClick }: PropsWithChildren<{ onClick: () => void }>) { return <button className="primary" onClick={onClick}><Plus size={19} />{children}</button>; }
export function LinkButton({ children, onClick }: PropsWithChildren<{ onClick: () => void }>) { return <button className="text-button" onClick={onClick}>{children}<ArrowRight size={18} /></button>; }
export function NumberValue({ value, unit = 'L' }: { value: number | null; unit?: string }) {
  const { state, t } = useAsu();
  return <span className="number">{value === null ? t('Por medir', 'Not measured') : <>{formatNumber(value, state.locale)} <small>{unit}</small></>}</span>;
}
export function CategoryName({ category }: { category: 'drinking' | 'other' }) {
  const { t } = useAsu(); return <>{category === 'drinking' ? t('Bebida y cocina', 'Drinking & cooking') : t('Otros usos', 'Other uses')}</>;
}
export function FormError({ message, id, reserveSpace = false }: { message: string; id?: string; reserveSpace?: boolean }) {
  const feedback = message ? <p role="alert" id={id} className="form-error">{message}</p> : null;
  // Keep pointer targets stationary when blur validation clears its message.
  return reserveSpace ? <div className="form-feedback">{feedback}</div> : feedback;
}
