import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { featuresFor, predict, validateModel } from './index';

describe('published Python/scikit-learn artifact parity in Node', () => {
  it('matches all 10,000 actual fixture vectors within 1e-4 hours', () => {
    const candidateDir = process.env.ASU_PARITY_DIR;
    const modelPath = candidateDir ? resolve(candidateDir, 'model.json') : new URL('../../../apps/web/public/models/current/model.json', import.meta.url);
    const fixturePath = candidateDir ? resolve(candidateDir, 'parity-fixtures.json') : new URL('../../../artifacts/current/parity-fixtures.json', import.meta.url);
    const model = validateModel(JSON.parse(readFileSync(modelPath, 'utf8')));
    const fixtures = z.object({
      inputs: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()])).min(10000),
      expected: z.array(z.tuple([z.number(), z.number(), z.number()])).min(10000),
    }).parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
    expect(fixtures.inputs.length).toBe(fixtures.expected.length);
    expect(model.label_semantics_approved).toBe(false);
    expect(model.target_semantics).toBe('reported_duration_not_actual_restoration');
    expect(model.source_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(model.support.combinations.length).toBeGreaterThan(0);
    let maxAbsoluteError = 0;
    for (let i = 0; i < fixtures.inputs.length; i++) {
      const actual = predict(model, fixtures.inputs[i]);
      actual.forEach((value, q) => { maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(value - fixtures.expected[i][q])); });
    }
    console.info(JSON.stringify({ model_version: model.model_version, data_cutoff: model.data_cutoff, vectors: fixtures.inputs.length, max_absolute_error_hours: maxAbsoluteError }));
    expect(maxAbsoluteError).toBeLessThanOrEqual(1e-4);
    expect(featuresFor(model, 'SEDAPAL', 'LIMA', `${model.data_cutoff}T09:00:00-05:00`)).toHaveLength(5);
    expect(() => featuresFor(model, 'SEDAPAL', 'AMAZONAS', `${model.data_cutoff}T09:00:00-05:00`)).toThrow('unsupported-combination');
  });
});
