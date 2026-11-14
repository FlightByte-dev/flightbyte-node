import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('package.json', () => {
  it('has the same version as the code', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('has no runtime dependencies', () => {
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('is an ES module whose types come first', () => {
    expect(pkg.type).toBe('module');
    expect(pkg.sideEffects).toBe(false);
    expect(Object.keys(pkg.exports['.'])).toEqual(['types', 'default']);
    expect(pkg.exports['.']).toEqual({ types: './dist/index.d.ts', default: './dist/index.js' });
  });

  it('ships the build and the docs, not the sources or the tests', () => {
    expect(pkg.files).toEqual(['dist', 'README.md', 'CHANGELOG.md', 'LICENSE']);
  });

  it('asks for a Node that can require() it', () => {
    expect(pkg.engines.node).toBe('>=20.19');
  });
});
