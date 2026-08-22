import fs from 'fs';
import path from 'path';
import type { DiscoveredFile } from '../../app/lib/analyzer/types';

export function readFixtureFiles(fixtureDir: string): DiscoveredFile[] {
  const baseDir = path.resolve(process.cwd(), fixtureDir);
  const results: DiscoveredFile[] = [];

  function walk(current: string): void {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(baseDir, full).replace(/\\/g, '/');
        const content = fs.readFileSync(full, 'utf-8');
        results.push({
          path: rel,
          size: content.length,
          hash: `hash_${rel}`,
          content,
        });
      }
    }
  }

  walk(baseDir);
  return results;
}
