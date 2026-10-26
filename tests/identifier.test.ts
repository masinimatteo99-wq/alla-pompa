import { afterEach, expect, it, vi } from 'vitest';
import { createIdentifier } from '../src/data/identifier';

afterEach(() => vi.unstubAllGlobals());

it('genera identificativi distinti anche senza randomUUID su HTTP', () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal('crypto', { getRandomValues });
  const identifiers = Array.from({ length: 100 }, () => createIdentifier());
  expect(new Set(identifiers).size).toBe(100);
  for (const identifier of identifiers) {
    expect(identifier).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});
