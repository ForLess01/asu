import type { Category } from '../../../packages/domain/src/index';

/** Waves are decorative. The recorded amount alone controls the vertical fill position. */
export function WaterTank({ level, category, compact = false }: { level: number | null; category: Category; compact?: boolean }) {
  const fill = level === null ? 0 : Math.max(0, Math.min(1, level));
  return <div className={`tank-column ${compact ? 'compact' : ''}`} data-category={category} aria-hidden="true">
    <div className={`tank-fill ${category}`} data-level={level === null ? 'unknown' : String(fill)} style={{ transform: `translateY(${(1-fill)*100}%)` }}>
      <div className="tank-water" />
      {fill > 0 && <>{['back', 'front'].map(layer => <svg key={layer} className={`water-wave ${layer}`} viewBox="0 0 120 12" preserveAspectRatio="none" focusable="false"><path d="M0 6 C10 0 20 0 30 6 S50 12 60 6 S80 0 90 6 S110 12 120 6 V12 H0Z" /></svg>)}</>}
    </div>
  </div>;
}
