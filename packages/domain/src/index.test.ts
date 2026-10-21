import { describe, it, expect } from 'vitest';
import { autonomy, balance, compareScenario, liters, validateContainer, validateIncident, emptyWorkspace, parseWorkspace } from './index';

describe('household planning invariants', () => {
  it('matches the documented 800 L / 200 L/h acceptance case', () => {
    expect(autonomy(800, 200)).toEqual({ status: 'known', hours: 4 });
    expect(compareScenario(800, 200, 6)).toEqual({ required: 1200, remaining: 0, deficit: 400 });
  });
  it('distinguishes unknown reserve and unknown or zero consumption from known zero reserve', () => {
    expect(autonomy(null, 10).status).toBe('unknown-reserve');
    expect(autonomy(20, null).status).toBe('unknown-consumption');
    expect(autonomy(20, 0).status).toBe('unknown-consumption');
    expect(autonomy(0, 10)).toEqual({ status: 'known', hours: 0 });
  });
  it('converts explicit units and rejects invalid amounts', () => {
    expect(liters(0.8, 'm3')).toBe(800);
    expect(liters(1500, 'ml')).toBe(1.5);
    expect(() => liters(-1, 'L')).toThrow();
    expect(() => liters(Infinity, 'L')).toThrow();
  });
  it('clamps each category to capacity without making nonpotable water drinkable', () => {
    const result = balance({ drinking: 10, other: 100 }, { drinking: 20, other: 100 }, { drinking: 0, other: 80 }, { drinking: 30, other: 5 });
    expect(result).toEqual({ drinking: 0, other: 100 });
  });
  it('blocks over-capacity, negative and invalid container inputs while allowing unknowns', () => {
    expect(validateContainer({ capacity: 10, volume: 11 })).toBe(false);
    expect(validateContainer({ capacity: -1, volume: 0 })).toBe(false);
    expect(validateContainer({ capacity: null, volume: null })).toBe(true);
    expect(validateContainer({ capacity: 0, volume: 0 })).toBe(false);
  });
  it('rejects future active starts and restoration before the start', () => {
    const now = Date.parse('2026-10-20T12:00:00-05:00');
    expect(validateIncident('2026-10-21T12:00:00-05:00', undefined, now)).toBe(false);
    expect(validateIncident('2026-10-20T10:00:00-05:00', '2026-10-20T09:00:00-05:00', now)).toBe(false);
    expect(validateIncident('2026-10-20T10:00:00-05:00', '2026-10-20T11:00:00-05:00', now)).toBe(true);
  });
  it('validates portable snapshots and rejects corrupt state, impossible reserves and duplicate IDs', () => {
    const state = emptyWorkspace();
    expect(parseWorkspace(JSON.stringify(state))).toEqual(state);
    expect(() => parseWorkspace('{broken')).toThrow();
    expect(() => parseWorkspace(JSON.stringify({ ...state, schema_version: 99 }))).toThrow();
    const container = { id: 'a', name: 'Tank', category: 'drinking', capacity: 10, volume: 11, observedAt: new Date().toISOString() };
    expect(() => parseWorkspace(JSON.stringify({ ...state, containers: [container] }))).toThrow();
    expect(() => parseWorkspace(JSON.stringify({ ...state, containers: [{ ...container, volume: 1 }, { ...container, volume: 1 }] }))).toThrow();
  });
});
