import fs from 'node:fs';
import crypto from 'node:crypto';
const modelBytes = fs.readFileSync('dist/models/current/model.json');
const model = JSON.parse(modelBytes);
fs.writeFileSync('dist/version.json', JSON.stringify({
  schema_version: 1,
  commit: process.env.CODE_REVISION ?? 'local-uncommitted',
  model_version: model.model_version,
  model_sha256: crypto.createHash('sha256').update(modelBytes).digest('hex'),
  target_semantics: model.target_semantics,
  label_semantics_approved: model.label_semantics_approved,
  packaged_at: new Date().toISOString(),
}, null, 2));
