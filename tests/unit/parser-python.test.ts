import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { PythonSyntaxParser } from '../../app/lib/analyzer/parser/python';
import { getSyntaxParser, languageForPath, registeredLanguages } from '../../app/lib/analyzer/parser/registry';
import type { SyntaxFacts } from '../../app/lib/analyzer/parser/types';

const FIXTURES = 'tests/fixtures/parser-python';

async function parseFixture(name: string): Promise<SyntaxFacts> {
  const parser = await getSyntaxParser('python');
  expect(parser).not.toBeNull();
  const source = fs.readFileSync(path.resolve(process.cwd(), FIXTURES, name), 'utf-8');
  const { facts } = await parser!.parse({ source });
  return facts;
}

function importFor(facts: SyntaxFacts, module: string) {
  return facts.imports.find((entry) => entry.module === module);
}

describe('Tree-sitter runtime & registry', () => {
  it('registers python, javascript/typescript/go and resolves them by extension', () => {
    expect(registeredLanguages()).toContain('python');
    expect(registeredLanguages()).toContain('javascript');
    expect(registeredLanguages()).toContain('typescript');
    expect(registeredLanguages()).toContain('go');
    expect(languageForPath('src/main.py')).toBe('python');
    expect(languageForPath('src/main.pyi')).toBe('python');
    expect(languageForPath('src/main.js')).toBe('javascript');
    expect(languageForPath('src/app.ts')).toBe('typescript');
    expect(languageForPath('src/comp.tsx')).toBe('tsx');
    expect(languageForPath('main.go')).toBe('go');
  });

  it('caches the parser instance per language', async () => {
    const first = await getSyntaxParser('python');
    const second = await getSyntaxParser('python');
    expect(first).toBe(second);
  });

  it('produces complete quality for well-formed source', async () => {
    const { facts } = await new PythonSyntaxParser().parse({ source: 'def ok():\n    pass\n' });
    expect(facts.quality).toBe('complete');
    expect(facts.parse.success).toBe(true);
    expect(facts.parse.errorNodes).toBe(0);
  });

  it('survives malformed source without throwing and marks partial', async () => {
    const { facts } = await new PythonSyntaxParser().parse({ source: 'def hello(\n' });
    expect(facts.parse.success).toBe(true);
    expect(facts.parse.hasErrors).toBe(true);
    expect(facts.quality).toBe('partial');
    expect(facts.parse.errorNodes).toBeGreaterThan(0);
  });
});

describe('Python syntax extraction (fixtures)', () => {
  it('extracts multiline signatures, classes and methods with real ranges', async () => {
    const facts = await parseFixture('multiline-signatures.py');

    const complicated = facts.symbols.find((s) => s.name === 'complicated');
    expect(complicated?.kind).toBe('function');
    expect(complicated?.range.startLine).toBe(1);
    expect(complicated?.range.endLine).toBeGreaterThan(1);
    expect(complicated?.range.startColumn).toBe(0);

    const wide = facts.symbols.find((s) => s.name === 'WideService');
    expect(wide?.kind).toBe('class');
    expect(wide?.bases).toContain('BaseMixin');

    const method = facts.symbols.find((s) => s.name === 'method_with_long_signature');
    expect(method?.kind).toBe('method');
    expect(method?.parent).toBe('WideService');
  });

  it('ignores code-shaped strings and comments', async () => {
    const facts = await parseFixture('strings-and-comments.py');

    const names = facts.symbols.map((s) => s.name);
    expect(names).toEqual(['real_function']);
    expect(names).not.toContain('fake');
    expect(names).not.toContain('NotReal');
    expect(names).not.toContain('also_fake');
    expect(names).not.toContain('fake_comment');

    const callees = facts.calls.map((c) => c.callee);
    expect(callees).not.toContain('create_user()');
    expect(callees.some((c) => c.endsWith('.join'))).toBe(true);
  });

  it('preserves multiline decorators structurally and derives routes later', async () => {
    const facts = await parseFixture('decorators-multiline.py');

    const getItem = facts.symbols.find((s) => s.name === 'get_item');
    expect(getItem?.decorators.length).toBe(1);
    const decorator = getItem!.decorators[0];
    expect(decorator.name).toBe('router.get');
    expect(decorator.argumentsText).toContain('/items/{item_id}');
    expect(decorator.argumentsText).toContain('response_model=ItemResponse');
    expect(decorator.range.endLine).toBeGreaterThan(decorator.range.startLine);

    expect(getItem?.isAsync).toBe(true);

    const bareApp = facts.symbols.find((s) => s.name === 'bare_app_decorator');
    expect(bareApp?.decorators[0].name).toBe('app.post');
  });

  it('captures call receivers, chains and assignment targets', async () => {
    const facts = await parseFixture('nested-and-calls.py');

    const inner = facts.symbols.find((s) => s.name === 'inner');
    expect(inner?.parent).toBe('outer');

    const helperCall = facts.calls.find((c) => c.callee === 'helper');
    expect(helperCall?.receiver).toBeNull();
    expect(helperCall?.ownerQualifiedName).toBe('outer::inner');

    const serviceSave = facts.calls.find((c) => c.callee === 'service.save');
    expect(serviceSave?.receiver).toBe('service');
    expect(serviceSave?.ownerQualifiedName).toBe('Handler::create');

    const userServiceCtor = facts.calls.find((c) => c.callee === 'UserService');
    expect(userServiceCtor?.assignedTo).toBe('service');

    const upstreamGet = facts.calls.find((c) => c.callee === 'client.get');
    expect(upstreamGet?.argumentsText).toBe('"/upstream"');
  });

  it('records plain imports, aliases and relative depth without losing information', async () => {
    const facts = await parseFixture('aliases-and-relative-imports.py');

    expect(importFor(facts, 'numpy')?.names).toEqual(['numpy']);

    const pandas = importFor(facts, 'pandas');
    expect(pandas?.aliases).toEqual({ pandas: 'pd' });
    expect(importFor(facts, 'collections')).toBeDefined();

    const service = importFor(facts, 'foo.services');
    expect(service?.names).toEqual(['UserService']);
    expect(service?.aliases).toEqual({ UserService: 'Service' });

    const sibling = importFor(facts, '.');
    expect(sibling?.relativeLevel).toBe(1);
    expect(sibling?.names).toEqual(['sibling']);

    const models = importFor(facts, '..models');
    expect(models?.relativeLevel).toBe(2);
    expect(models?.names).toEqual(['User']);

    const coreUsers = importFor(facts, '...core.users');
    expect(coreUsers?.relativeLevel).toBe(3);
    expect(coreUsers?.aliases).toEqual({ get_user: 'fetch_user' });
  });

  it('marks syntactically broken files partial instead of crashing', async () => {
    const facts = await parseFixture('syntax-error.py');
    expect(facts.quality).toBe('partial');
    expect(facts.parse.hasErrors).toBe(true);
  });
});
