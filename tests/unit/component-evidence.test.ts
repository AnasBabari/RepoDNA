import { expect, it } from 'vitest';
import { getSyntaxParser } from '../../app/lib/analyzer/parser/registry';

for (const language of ['javascript', 'tsx'] as const) {
  it(`${language} preserves imported React factories and aliases without requiring JSX`, async () => {
    const parser = (await getSyntaxParser(language))!;
    const { facts } = await parser.parse({ source: `import R, {createElement as h} from 'react';
export const App = () => R.createElement('main');
export function Card() { return h('section'); }
export const Fake = () => React.createElement('main');
` });
    expect(facts.quality).toBe('complete');
    expect(facts.symbols.filter((symbol) => symbol.kind === 'component').map((symbol) => symbol.name)).toEqual(['App', 'Card']);
    expect(facts.symbols.find((symbol) => symbol.name === 'Fake')?.kind).toBe('function');
  });
  it(`${language} requires observed JSX, not uppercase names or strings, for component symbols`, async () => {
    const parser = (await getSyntaxParser(language))!;
    const { facts } = await parser.parse({ source: `
export function App() { return <main />; }
export const Card = () => <section>Card</section>;
export const Factory = () => 'React jsx <main />';
export function Text() { return 'React <main />'; }
export function Outer() { function Inner() { return <span />; } return 'plain'; }
` });
    expect(facts.quality).toBe('complete');
    expect(facts.symbols.filter((symbol) => symbol.kind === 'component').map((symbol) => symbol.name).sort()).toEqual(['App', 'Card', 'Inner']);
    expect(facts.symbols.filter((symbol) => symbol.kind === 'function').map((symbol) => symbol.name)).toEqual(expect.arrayContaining(['Factory', 'Text', 'Outer']));
  });
}
