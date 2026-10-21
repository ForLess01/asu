import { describe, expect, it } from 'vitest';
import { departments, utilities, districtOptions, completeOption, matchOption } from './form-options';

describe('reference-backed form options', () => {
  it('offers all 25 department-level jurisdictions and real historical utility names', () => {
    expect(departments).toHaveLength(25);
    expect(departments).toContain('CALLAO'); expect(departments).toContain('MADRE DE DIOS');
    expect(utilities).toContain('SEDAPAL'); expect(utilities).toContain('SEDACUSCO');
    expect(new Set(utilities).size).toBe(utilities.length);
  });
  it('filters districts by department and does not accept arbitrary restricted text', () => {
    const lima = districtOptions('LIMA');
    expect(matchOption('pueblo libre', lima)?.value).toBe('Pueblo Libre');
    expect(matchOption('Not a district', lima)).toBeUndefined();
    expect(matchOption('Pueblo Libre', districtOptions('AREQUIPA'))).toBeUndefined();
    expect(new Set(lima.map(o => o.value)).size).toBe(lima.length);
  });
  it('completes only an unambiguous typed prefix, never an empty placeholder or ambiguous guess', () => {
    const options = [{ value: 'Tanque principal' }, { value: 'Tanque secundario' }, { value: 'Bidón de cocina' }];
    expect(completeOption('Bid', options)?.value).toBe('Bidón de cocina');
    expect(completeOption('', options)).toBeUndefined();
    expect(completeOption('Tanque', options)).toBeUndefined();
  });
});
