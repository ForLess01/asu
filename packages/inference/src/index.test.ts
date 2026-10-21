import { describe, expect, it } from 'vitest';
import { validateModel, predict, featuresTimeLima, featuresFor, predictActualRestoration } from './index';

export const model = {
  schema_version: 1, model_version: 'synthetic-test', status: 'experimental',
  target_semantics: 'reported_duration_not_actual_restoration', label_semantics_approved: false,
  feature_order: ['month', 'weekday', 'hour', 'eps', 'department'],
  preprocessing: { categories: { eps: ['SEDAPAL'], department: ['LIMA'] }, unknown_value: -1 },
  models: Object.fromEntries(['p10', 'p50', 'p90'].map((key, i) => [key, {
    init: i + 2, learning_rate: 0.5, trees: [{ children_left: [1, -1, -1], children_right: [2, -1, -1], feature: [0, -2, -2], threshold: [6.5, -2, -2], value: [0, 2, 6] }],
  }])), calibration: { offset_hours: 1, nominal_coverage: 0.8 },
  support: { eps_codes: ['SEDAPAL'], departments: ['LIMA'], combinations: [{ eps: 'SEDAPAL', department: 'LIMA' }] }, data_cutoff: '2024-05-07', source_sha256: 'synthetic',
};

describe('portable GBR contract', () => {
  it('follows a known tree on each side and applies calibration exactly', () => {
    const parsed = validateModel(model);
    expect(predict(parsed, [6, 0, 0, 0, 0])).toEqual([2, 4, 6]);
    expect(predict(parsed, [7, 0, 0, 0, 0])).toEqual([4, 6, 8]);
  });
  it('reproduces float32 threshold semantics and double accumulation', () => {
    const parsed = validateModel(model);
    expect(predict(parsed, [6.50000001, 0, 0, 0, 0])).toEqual([2, 4, 6]);
  });
  it('uses Lima time, Monday zero, fractional hours without local machine timezone', () => {
    expect(featuresTimeLima('2024-01-02T02:30:00Z')).toEqual([1, 0, 21.5]);
    expect(() => featuresTimeLima('not a date')).toThrow();
  });
  it('abstains for unsupported categories or malformed times', () => {
    const parsed = validateModel(model);
    expect(() => featuresFor(parsed, 'UNKNOWN', 'LIMA', '2024-01-01T00:00:00-05:00')).toThrow();
    expect(() => featuresFor(parsed, 'SEDAPAL', 'LIMA', '')).toThrow();
    expect(() => featuresTimeLima('2024-02-30T09:00:00-05:00')).toThrow();
  });
  it('rejects an unseen pair even when each category is individually supported', () => {
    const parsed = validateModel({ ...model,
      preprocessing: { ...model.preprocessing, categories: { eps: ['SEDAPAL', 'SEDAPAR'], department: ['LIMA', 'AREQUIPA'] } },
      support: { eps_codes: ['SEDAPAL', 'SEDAPAR'], departments: ['LIMA', 'AREQUIPA'], combinations: [{ eps: 'SEDAPAL', department: 'LIMA' }, { eps: 'SEDAPAR', department: 'AREQUIPA' }] },
    });
    expect(() => featuresFor(parsed, 'SEDAPAL', 'AREQUIPA', '2024-01-01T00:00:00-05:00')).toThrow('unsupported-combination');
    expect(featuresFor(parsed, 'SEDAPAR', 'AREQUIPA', '2024-01-01T00:00:00-05:00')).toEqual([1, 0, 0, 1, 1]);
    expect(() => validateModel({ ...model, support: { ...model.support, combinations: [] } })).toThrow();
  });
  it('rejects malformed, cyclic, unreachable, shared-node and oversized tree graphs in bounded work', () => {
    const withTree = (tree: unknown) => ({ ...model, models: { ...model.models, p10: { init: 0, learning_rate: 1, trees: [tree] } } });
    const tree = { children_left: [1, -1, -1], children_right: [2, -1, -1], feature: [0, -2, -2], threshold: [6.5, -2, -2], value: [0, 2, 6] };
    expect(() => validateModel(withTree({ ...tree, value: [1] }))).toThrow();
    expect(() => validateModel(withTree({ ...tree, children_left: [0, -1, -1] }))).toThrow();
    expect(() => validateModel(withTree({ ...tree, children_right: [1, -1, -1] }))).toThrow();
    expect(() => validateModel(withTree({ ...tree, children_left: [-1, -1, -1], children_right: [-1, -1, -1] }))).toThrow();
    const n = 8192;
    expect(() => validateModel(withTree({ children_left: Array(n).fill(-1), children_right: Array(n).fill(-1), feature: Array(n).fill(-2), threshold: Array(n).fill(-2), value: Array(n).fill(1) }))).toThrow();
  });
  it('rejects corrupt trees, unsupported schema and false actual-restoration claims', () => {
    expect(() => validateModel({ ...model, schema_version: 3 })).toThrow();
    expect(() => validateModel({ ...model, models: { p10: { trees: [] } } })).toThrow();
    expect(() => predictActualRestoration(validateModel(model))).toThrow('actual-restoration-unavailable');
  });
});
