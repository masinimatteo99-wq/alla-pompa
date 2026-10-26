import { calculateHistory } from '../domain/calculations';
import type { CalculationResult, Refueling, Vehicle } from '../domain/models';

type Gap = Pick<Refueling, 'date' | 'odometerKm'>;

export interface Archive {
  vehicle: Vehicle;
  refuelings: Refueling[];
  /** Posizioni degli acquisti reali eliminati, per non ricostruire misure incomplete. */
  gaps: Gap[];
}

export function emptyArchive(): Archive {
  return { vehicle: { id: 'vehicle-1', name: 'La mia auto' }, refuelings: [], gaps: [] };
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Il file contiene un oggetto non valido.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error('Il file contiene un campo di testo mancante o non valido.');
  }
  return value;
}

/** Ricostruisce solo i campi conosciuti: nessun valore importato viene eseguito come HTML. */
export function validateArchive(value: unknown): Archive {
  const data = object(value);
  const rawVehicle = object(data.vehicle);
  const vehicle: Vehicle = {
    id: text(rawVehicle.id), name: text(rawVehicle.name, 80),
    ...(rawVehicle.tankCapacityLiters === undefined ? {} : {
      tankCapacityLiters: rawVehicle.tankCapacityLiters as number,
    }),
  };
  if (vehicle.tankCapacityLiters !== undefined && (typeof vehicle.tankCapacityLiters !== 'number'
    || !Number.isFinite(vehicle.tankCapacityLiters) || vehicle.tankCapacityLiters <= 0)) {
    throw new Error('Capacità del serbatoio non valida.');
  }
  if (!Array.isArray(data.refuelings) || data.refuelings.length > 10_000) {
    throw new Error('Elenco rifornimenti non valido o superiore a 10.000 registrazioni.');
  }
  const refuelings: Refueling[] = data.refuelings.map((value) => {
    const r = object(value);
    if (typeof r.odometerKm !== 'number' || typeof r.full !== 'boolean'
      || (r.breakBefore !== undefined && typeof r.breakBefore !== 'boolean')) {
      throw new Error('Chilometraggio o indicazione pieno/interruzione non validi.');
    }
    return {
      id: text(r.id), date: text(r.date), odometerKm: r.odometerKm,
      liters: text(r.liters), pricePerLiter: text(r.pricePerLiter), full: r.full,
      ...(r.time === undefined ? {} : { time: text(r.time) }),
      ...(r.breakBefore === undefined ? {} : { breakBefore: r.breakBefore }),
    };
  });
  const rawGaps = data.gaps ?? [];
  if (!Array.isArray(rawGaps) || rawGaps.length > 10_000) throw new Error('Interruzioni dello storico non valide.');
  const gaps: Gap[] = rawGaps.map((value) => {
    const gap = object(value);
    if (typeof gap.odometerKm !== 'number') throw new Error('Interruzione dello storico non valida.');
    const coordinate = { date: text(gap.date), odometerKm: gap.odometerKm };
    calculateHistory([{ ...coordinate, id: 'validation', liters: '1', pricePerLiter: '0', full: true }]);
    return coordinate;
  });
  // Verifica anche l'ordine dei dati originali, indipendentemente dalle interruzioni.
  calculateHistory(refuelings);
  const archive = { vehicle, refuelings, gaps };
  calculateArchive(archive);
  return archive;
}

export function exportBackup(archive: Archive): string {
  return JSON.stringify({
    app: 'alla-pompa', version: 1, exportedAt: new Date().toISOString(),
    data: validateArchive(archive),
  }, null, 2);
}

export function importBackup(json: string): Archive {
  if (json.length > 5_000_000) throw new Error('Backup troppo grande: il limite è 5 MB.');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('Il file non è un JSON valido.'); }
  const backup = object(parsed);
  if (backup.app !== 'alla-pompa' || backup.version !== 1) {
    throw new Error('Formato o versione del backup non supportati.');
  }
  if (typeof backup.exportedAt !== 'string' || !Number.isFinite(Date.parse(backup.exportedAt))) {
    throw new Error('Data di esportazione non valida.');
  }
  return validateArchive(backup.data);
}

export function sortedRefuelings(records: readonly Refueling[]): Refueling[] {
  return [...records].sort((a, b) => a.date.localeCompare(b.date)
    || a.odometerKm - b.odometerKm || (a.time ?? '').localeCompare(b.time ?? ''));
}

function compareCoordinates(a: Gap, b: Gap): number {
  return a.date.localeCompare(b.date) || a.odometerKm - b.odometerKm;
}

export function measurementRecords(archive: Archive): Refueling[] {
  const sorted = sortedRefuelings(archive.refuelings);
  for (const gap of archive.gaps) {
    const index = sorted.findIndex((r) => compareCoordinates(r, gap) >= 0);
    const next = sorted[index];
    if (next) sorted[index] = { ...next, breakBefore: true };
  }
  return sorted;
}

export function calculateArchive(archive: Archive): CalculationResult {
  const records = measurementRecords(archive);
  const result = calculateHistory(records);
  const last = records.at(-1);
  if (archive.gaps.some((gap) => !last || compareCoordinates(last, gap) < 0)) {
    return { ...result, status: 'no-reference', openInterval: null };
  }
  return result;
}

/** Rimuovere un evento reale richiede un nuovo riferimento, non un consumo fittizio. */
export function removeRefueling(archive: Archive, id: string, actualPurchase: boolean): Archive {
  const sorted = sortedRefuelings(archive.refuelings);
  const index = sorted.findIndex((r) => r.id === id);
  if (index < 0) throw new Error('Rifornimento non trovato.');
  const removed = sorted[index]!;
  sorted.splice(index, 1);
  const gaps = [...archive.gaps];
  if (actualPurchase || removed.breakBefore) gaps.push({ date: removed.date, odometerKm: removed.odometerKm });
  return validateArchive({ ...archive, refuelings: sorted, gaps });
}
