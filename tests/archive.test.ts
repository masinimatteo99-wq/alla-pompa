import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateArchive, emptyArchive, exportBackup, importBackup, removeRefueling, validateArchive } from '../src/data/archive';
import type { Archive } from '../src/data/archive';
import { loadArchive, saveArchive } from '../src/data/storage';

function fixture(): Archive {
  return { ...emptyArchive(), refuelings: [
    { id: 'a', date: '2026-01-01', odometerKm: 1000, liters: '30', pricePerLiter: '1,759', full: true },
    { id: 'p', date: '2026-01-05', odometerKm: 1200, liters: '10', pricePerLiter: '1,8', full: false },
    { id: 'b', date: '2026-01-10', odometerKm: 1600, liters: '26', pricePerLiter: '1,7', full: true },
  ] };
}

describe('Backup e interruzioni', () => {
  it('ripristina dati, precisione e risultati identici', () => {
    const data = fixture();
    data.vehicle = { ...data.vehicle, tankCapacityLiters: 45.5 };
    const restored = importBackup(exportBackup(data));
    expect(restored).toEqual(data);
    expect(calculateArchive(restored)).toEqual(calculateArchive(data));
  });

  it.each([
    'non json', 'null', '[]', '{}',
    JSON.stringify({ app: 'alla-pompa', version: 99 }),
    JSON.stringify({ app: 'altra-app', version: 1 }),
    JSON.stringify({ app: 'alla-pompa', version: 1, exportedAt: 'non-data', data: fixture() }),
  ])('rifiuta backup incompatibili: %s', (file) => {
    expect(() => importBackup(file)).toThrow();
  });

  it('rifiuta dati interni incoerenti prima di ripristinare', () => {
    const backup = JSON.parse(exportBackup(fixture()));
    backup.data.refuelings[1].odometerKm = 500;
    expect(() => importBackup(JSON.stringify(backup))).toThrow(/decrescenti/);
    backup.data.refuelings[1] = null;
    expect(() => importBackup(JSON.stringify(backup))).toThrow();
  });

  it('scarta campi estranei senza interpretare contenuti HTML', () => {
    const data = fixture();
    data.vehicle = { id: 'v', name: '<img src=x onerror=alert(1)>' };
    expect(validateArchive({ ...data, unexpected: 'field' })).toEqual(data);
  });

  it('eliminare un acquisto vero non produce un consumo falsamente basso', () => {
    const result = removeRefueling(fixture(), 'p', true);
    expect(result.gaps).toEqual([{ date: '2026-01-05', odometerKm: 1200 }]);
    expect(calculateArchive(result).average).toBeNull();
    expect(importBackup(exportBackup(result))).toEqual(result);
  });

  it('eliminare un inserimento errato ricalcola normalmente', () => {
    expect(calculateArchive(removeRefueling(fixture(), 'p', false)).average?.litersPer100Km)
      .toBeCloseTo(26 / 600 * 100);
  });

  it('conserva un’interruzione finale fino a un futuro pieno', () => {
    const result = removeRefueling(fixture(), 'b', true);
    expect(calculateArchive(result).status).toBe('no-reference');
    result.refuelings.push({
      id: 'c', date: '2026-01-20', odometerKm: 2000, liters: '30', pricePerLiter: '2', full: true,
    });
    expect(calculateArchive(result).average).toBeNull();
    expect(calculateArchive(result).openInterval?.startId).toBe('c');
    result.refuelings.push({
      id: 'd', date: '2026-01-25', odometerKm: 2500, liters: '25', pricePerLiter: '2', full: true,
    });
    expect(calculateArchive(result).average?.litersPer100Km).toBe(5);
  });

  it('non perde una segnalazione di interruzione eliminando la sua registrazione', () => {
    const data = fixture();
    data.refuelings[1] = { ...data.refuelings[1]!, breakBefore: true };
    expect(calculateArchive(removeRefueling(data, 'p', false)).average).toBeNull();
  });
});

describe('IndexedDB e atomicità', () => {
  beforeEach(async () => {
    const current = await loadArchive();
    await saveArchive(emptyArchive(), current.revision);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('conserva l’archivio tra letture indipendenti', async () => {
    const current = await loadArchive();
    const saved = await saveArchive(fixture(), current.revision);
    expect(await loadArchive()).toEqual(saved);
  });

  it('un ripristino non valido lascia intatti dati e revisione', async () => {
    const current = await loadArchive();
    const saved = await saveArchive(fixture(), current.revision);
    await expect(saveArchive({ ...emptyArchive(), vehicle: { id: 'v', name: '' } }, saved.revision)).rejects.toThrow();
    expect(await loadArchive()).toEqual(saved);
  });

  it('una transazione abortita conserva l’archivio precedente', async () => {
    const current = await loadArchive();
    const saved = await saveArchive(fixture(), current.revision);
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (
      this: IDBObjectStore, value: unknown, key?: IDBValidKey,
    ) {
      const request = original.call(this, value, key);
      this.transaction.abort();
      return request;
    });
    await expect(saveArchive(emptyArchive(), saved.revision)).rejects.toThrow();
    expect(await loadArchive()).toEqual(saved);
  });

  it('due schede concorrenti non si sovrascrivono silenziosamente', async () => {
    const current = await loadArchive();
    const attempts = await Promise.allSettled([
      saveArchive(fixture(), current.revision), saveArchive(emptyArchive(), current.revision),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    expect((await loadArchive()).data).toEqual(fixture());
  });
});
