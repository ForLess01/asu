import { featuresFor, loadModelBundle, predict, type PortableModel } from '../../../packages/inference/src/index';

let model: PortableModel | undefined;
self.onmessage = async (event: MessageEvent<{ id: number; type: 'load' | 'predict'; eps?: string; department?: string; startedAt?: string }>) => {
  const { id, type, eps, department, startedAt } = event.data;
  try {
    if (type === 'load') {
      model = undefined;
      const bundle = await loadModelBundle(undefined, AbortSignal.timeout(15000));
      model = bundle.model;
      self.postMessage({ id, type: 'ready', ...bundle });
    } else {
      if (!model) throw new Error('model-unavailable');
      const values = predict(model, featuresFor(model, eps ?? '', department ?? '', startedAt ?? ''));
      self.postMessage({ id, type: 'prediction', values, modelVersion: model.model_version });
    }
  } catch (error) { self.postMessage({ id, type: 'error', error: error instanceof Error ? error.message : 'model-unavailable' }); }
};
