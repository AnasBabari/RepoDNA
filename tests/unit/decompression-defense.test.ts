import * as fflate from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractFromZip } from '../../app/lib/analyzer/ingestion';

describe('True Bounded Decompression Defense & Adversarial ZIP Protection', () => {
  it('enforces hard maxArchiveEntries cap against header bombs (>20,000 entries)', async () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < 250; i++) {
      entries[`folder_${i}/empty_${i}.txt`] = new Uint8Array(0);
    }
    const buffer = fflate.zipSync(entries);

    // Test with a low custom archive entry cap of 100
    const customLimits = {
      maxFiles: 10_000,
      maxArchiveEntries: 100,
      maxFileBytes: 1_000_000,
      maxArchiveBytes: 25 * 1024 * 1024,
      maxTotalExtractedBytes: 100 * 1024 * 1024,
      fetchTimeoutMs: 20_000,
    };

    await expect(extractFromZip(buffer, 'header-bomb', customLimits)).rejects.toMatchObject({
      code: 'TOO_MANY_ARCHIVE_ENTRIES',
      status: 413,
    });
  });

  it('aborts oversized file stream early and records skipped without materializing full payload', async () => {
    // 5 MB of zeroes compresses down to ~5 KB
    const fiveMegabytesOfZeroes = new Uint8Array(5 * 1024 * 1024);
    const buffer = fflate.zipSync({
      'repo-main/valid.py': fflate.strToU8('print("valid code")'),
      'repo-main/oversized.py': fiveMegabytesOfZeroes,
    });

    const customLimits = {
      maxFiles: 10_000,
      maxArchiveEntries: 20_000,
      maxFileBytes: 500 * 1024, // 500 KB per-file limit
      maxArchiveBytes: 25 * 1024 * 1024,
      maxTotalExtractedBytes: 50 * 1024 * 1024,
      fetchTimeoutMs: 20_000,
    };

    const result = await extractFromZip(buffer, 'repo', customLimits);

    expect(result.files.map((f) => f.path)).toEqual(['valid.py']);
    expect(result.skipped).toContainEqual(
      expect.objectContaining({ path: 'oversized.py', reason: 'exceeds_file_size_limit' })
    );
  });

  it('aborts entire archive on suspicious compression ratio (>200:1 past 256 KB floor)', async () => {
    // 8 MB of zeroes compressed to ~8 KB (ratio ~1000:1)
    const eightMbZeroes = new Uint8Array(8 * 1024 * 1024);
    const buffer = fflate.zipSync({
      'repo-main/ratio-bomb.py': eightMbZeroes,
    });

    const customLimits = {
      maxFiles: 10_000,
      maxArchiveEntries: 20_000,
      maxFileBytes: 10 * 1024 * 1024, // High file limit so ratio guard triggers first
      maxArchiveBytes: 25 * 1024 * 1024,
      maxTotalExtractedBytes: 50 * 1024 * 1024,
      fetchTimeoutMs: 20_000,
    };

    await expect(extractFromZip(buffer, 'ratio-bomb-repo', customLimits)).rejects.toMatchObject({
      code: 'SUSPICIOUS_COMPRESSION_RATIO',
      status: 413,
    });
  });

function makeRealisticCode(targetBytes: number): Uint8Array {
  const chunks: string[] = [];
  let currentBytes = 0;
  let i = 0;
  while (currentBytes < targetBytes) {
    const chunk = `export function fn_${i}(param_${i}: string, count_${i}: number): boolean {\n  const token_${i} = "salt_${(i * 997).toString(36)}_${i}";\n  return param_${i}.length > count_${i};\n}\n`;
    chunks.push(chunk);
    currentBytes += chunk.length;
    i++;
  }
  return fflate.strToU8(chunks.join('').slice(0, targetBytes));
}

  it('enforces total extracted content limit on multiple valid-sized files', async () => {
    const eightHundredKb = makeRealisticCode(800 * 1024);
    const buffer = fflate.zipSync({
      'repo-main/file_1.py': eightHundredKb,
      'repo-main/file_2.py': eightHundredKb,
      'repo-main/file_3.py': eightHundredKb,
    });

    const customLimits = {
      maxFiles: 10_000,
      maxArchiveEntries: 20_000,
      maxFileBytes: 1024 * 1024, // 1 MB per file
      maxArchiveBytes: 25 * 1024 * 1024,
      maxTotalExtractedBytes: 2 * 1024 * 1024, // 2 MB total archive limit (3 * 800 KB = 2.4 MB)
      fetchTimeoutMs: 20_000,
    };

    await expect(extractFromZip(buffer, 'cumulative-repo', customLimits)).rejects.toMatchObject({
      code: 'EXTRACTED_TOO_LARGE',
      status: 413,
    });
  });

  it('counts emitted bytes from skipped oversized files with unknown metadata toward cumulative archive work budget', async () => {
    const onePointTwoMb = makeRealisticCode(1200 * 1024);
    const zip = fflate.zipSync({
      'repo-main/bomb_1.py': onePointTwoMb,
      'repo-main/bomb_2.py': onePointTwoMb,
      'repo-main/bomb_3.py': onePointTwoMb,
    });

    // Zero out local file header uncompressed size fields so metadata does not skip prior to streaming
    const patched = new Uint8Array(zip);
    for (let i = 0; i < patched.byteLength - 30; i++) {
      if (patched[i] === 0x50 && patched[i+1] === 0x4b && patched[i+2] === 0x03 && patched[i+3] === 0x04) {
        patched[i + 22] = 0;
        patched[i + 23] = 0;
        patched[i + 24] = 0;
        patched[i + 25] = 0;
      }
    }

    const customLimits = {
      maxFiles: 10_000,
      maxArchiveEntries: 20_000,
      maxFileBytes: 1024 * 1024, // 1 MB per file
      maxArchiveBytes: 25 * 1024 * 1024,
      maxTotalExtractedBytes: 2 * 1024 * 1024, // 2 MB total archive limit (each file emits ~1 MB)
      fetchTimeoutMs: 20_000,
    };

    await expect(extractFromZip(patched, 'cumulative-bomb-repo', customLimits)).rejects.toMatchObject({
      code: 'EXTRACTED_TOO_LARGE',
      status: 413,
    });
  });

  it('enforces live output counters regardless of missing or uncompressed metadata', async () => {
    // Stored/uncompressed entry (compression method 0)
    const rawContent = fflate.strToU8('x'.repeat(2 * 1024 * 1024)); // 2 MB stored
    const buffer = fflate.zipSync({
      'repo-main/stored_large.py': [rawContent, { level: 0 }],
    });

    const customLimits = {
      maxFiles: 10_000,
      maxArchiveEntries: 20_000,
      maxFileBytes: 1024 * 1024, // 1 MB limit
      maxArchiveBytes: 25 * 1024 * 1024,
      maxTotalExtractedBytes: 50 * 1024 * 1024,
      fetchTimeoutMs: 20_000,
    };

    const result = await extractFromZip(buffer, 'stored-repo', customLimits);
    expect(result.files.length).toBe(0);
    expect(result.skipped).toContainEqual(
      expect.objectContaining({ path: 'stored_large.py', reason: 'exceeds_file_size_limit' })
    );
  });

  it('rejects corrupt or truncated ZIP data with INVALID_ARCHIVE', async () => {
    const corruptBuffer = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff, 0x00, 0x00]);

    await expect(extractFromZip(corruptBuffer, 'corrupt-repo')).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE',
      status: 400,
    });
  });

  it('enforces live output counter when declared uncompressed size in metadata lies (claims 100B, actually 3MB)', async () => {
    const threeMb = makeRealisticCode(3 * 1024 * 1024);
    const zip = fflate.zipSync({
      'repo-main/lying.py': threeMb,
    });

    // Patch the local header uncompressed size field to 100 bytes (0x64, 0x00, 0x00, 0x00)
    const patched = new Uint8Array(zip);
    for (let i = 0; i < patched.byteLength - 30; i++) {
      if (patched[i] === 0x50 && patched[i+1] === 0x4b && patched[i+2] === 0x03 && patched[i+3] === 0x04) {
        patched[i + 22] = 0x64; // 100 bytes
        patched[i + 23] = 0x00;
        patched[i + 24] = 0x00;
        patched[i + 25] = 0x00;
      }
    }

    const customLimits = {
      maxFiles: 10_000,
      maxArchiveEntries: 20_000,
      maxFileBytes: 1024 * 1024, // 1 MB limit
      maxArchiveBytes: 25 * 1024 * 1024,
      maxTotalExtractedBytes: 50 * 1024 * 1024,
      fetchTimeoutMs: 20_000,
    };

    const result = await extractFromZip(patched, 'lying-repo', customLimits);
    // Despite claiming 100 bytes, live output counter must detect > 1 MB and skip it
    expect(result.files.length).toBe(0);
    expect(result.skipped).toContainEqual(
      expect.objectContaining({ path: 'lying.py', reason: 'exceeds_file_size_limit' })
    );
  });

  it('handles archives containing only directory entries without crashing or hanging', async () => {
    const buffer = fflate.zipSync({
      'repo-main/': new Uint8Array(0),
      'repo-main/src/': new Uint8Array(0),
      'repo-main/docs/': new Uint8Array(0),
    });

    const result = await extractFromZip(buffer, 'dir-only-repo');
    expect(result.files.length).toBe(0);
    expect(result.skipped.length).toBe(0);
  });

  it('preserves clean file extraction and hash parity for normal multi-file repositories', async () => {
    const buffer = fflate.zipSync({
      'my-project-main/src/index.ts': fflate.strToU8('export const version = "1.0.0";'),
      'my-project-main/src/utils/math.ts': fflate.strToU8('export function add(a: number, b: number) { return a + b; }'),
      'my-project-main/package.json': fflate.strToU8('{"name": "my-project", "version": "1.0.0"}'),
      'my-project-main/README.md': fflate.strToU8('# My Project'),
      'my-project-main/.gitignore': fflate.strToU8('node_modules/\ndist/'),
      'my-project-main/node_modules/ignored.js': fflate.strToU8('console.log("ignored");'),
    });

    const result = await extractFromZip(buffer, 'my-project');

    expect(result.files.map((f) => f.path)).toEqual([
      'package.json',
      'README.md',
      'src/index.ts',
      'src/utils/math.ts',
    ]);
    expect(result.files[0].hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.skipped.length).toBe(0);
  });
});
