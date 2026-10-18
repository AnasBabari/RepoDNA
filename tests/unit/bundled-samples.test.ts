import { expect, it } from 'vitest';
import { bundledSample } from '../../app/lib/bundled-samples';

it('accepts only known root repositories as explicit snapshots', () => {
  expect(bundledSample('KARPATHY/nanoGPT')?.path).toBe('/samples/nanogpt.json');
  for (const input of ['owner/unknown', '/etc/passwd', 'https://evil.example/samples.json', 'karpathy/nanoGPT/tree/main', 'https://github.com/karpathy/nanoGPT/tree/main']) {
    expect(bundledSample(input)).toBeNull();
  }
});
