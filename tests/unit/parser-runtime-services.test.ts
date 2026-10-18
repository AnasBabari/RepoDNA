import { expect, it, vi } from 'vitest';
import { createTreeSitterServices, type TreeSitterModule } from '../../app/lib/analyzer/parser/runtime-core';

function fakeGlue(load: ReturnType<typeof vi.fn>) {
  class Parser {
    static init = vi.fn(async () => undefined);
    setLanguage = vi.fn();
  }
  return { Parser, Language: { load } } as unknown as TreeSitterModule;
}
it('passes explicit grammar bytes to the loader and caches successful parsers', async () => {
  const bytes = new Uint8Array([0, 97, 115, 109]);
  const load = vi.fn(async () => ({}));
  const input = vi.fn(async () => bytes);
  const services = createTreeSitterServices({ loadGlue: async () => fakeGlue(load), assetUrl: (file) => `/assets/${file}`, grammarInput: input });
  const first = await services.getParser('python');
  expect(await services.getParser('python')).toBe(first);
  expect(input).toHaveBeenCalledExactlyOnceWith('tree-sitter-python.wasm');
  expect(load).toHaveBeenCalledExactlyOnceWith(bytes);
});
it('recovers from failed grammar requests instead of retaining a rejected parser promise', async () => {
  const load = vi.fn(async () => ({}));
  const input = vi.fn().mockRejectedValueOnce(new Error('Grammar asset request failed (503).')).mockResolvedValue(new Uint8Array([0]));
  const services = createTreeSitterServices({ loadGlue: async () => fakeGlue(load), assetUrl: (file) => file, grammarInput: input });
  await expect(services.getParser('python')).rejects.toMatchObject({ code: 'TREE_SITTER_GRAMMAR_LOAD_FAILED' });
  await expect(services.getParser('python')).resolves.toBeDefined();
  expect(input).toHaveBeenCalledTimes(2);
});
it('preserves string-path grammar loading for the Node platform', async () => {
  const load = vi.fn(async () => ({}));
  const services = createTreeSitterServices({ loadGlue: async () => fakeGlue(load), assetUrl: (file) => `public/tree-sitter/${file}` });
  await services.getParser('go');
  expect(load).toHaveBeenCalledExactlyOnceWith('public/tree-sitter/tree-sitter-go.wasm');
});
