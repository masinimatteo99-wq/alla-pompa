import type { CalculationResult, CompleteInterval, ConsumptionMetrics, ConsumptionTrend, Refueling } from './models';

export class InvalidHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidHistoryError';
  }
}

function fail(message: string): never {
  throw new InvalidHistoryError(message);
}

function safeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) fail('Valore numerico fuori dai limiti supportati.');
  return value;
}

/** Litri -> millilitri; €/L -> millesimi di euro/L. Nessun arrotondamento implicito. */
export function parseThousandths(value: string): number {
  if (typeof value !== 'string') fail('Inserire il valore decimale come testo.');
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) {
    fail('Usare un numero non negativo con al massimo tre decimali, senza separatori delle migliaia.');
  }
  const [whole = '', fraction = ''] = normalized.split('.');
  return safeInteger(Number(whole + fraction.padEnd(3, '0')));
}

interface Normalized {
  record: Refueling;
  milliliters: number;
  costMicroEuros: number;
}

function normalize(records: readonly Refueling[]): Normalized[] {
  const ids = new Set<string>();
  const normalized = records.map((record) => {
    if (typeof record.id !== 'string' || !record.id.trim() || ids.has(record.id)) {
      fail('Ogni rifornimento deve avere un identificativo univoco non vuoto.');
    }
    ids.add(record.id);
    if (typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
      fail('Data non valida: usare YYYY-MM-DD.');
    }
    const date = new Date(`${record.date}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== record.date
      || record.date.startsWith('0000')) fail('Data inesistente.');
    if (record.time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(record.time)) {
      fail('Ora non valida: usare HH:mm.');
    }
    safeInteger(record.odometerKm);
    if (typeof record.full !== 'boolean'
      || (record.breakBefore !== undefined && typeof record.breakBefore !== 'boolean')) {
      fail('Indicazione pieno/interruzione non valida.');
    }
    const milliliters = parseThousandths(record.liters);
    if (milliliters === 0) fail('I litri devono essere maggiori di zero.');
    const priceThousandths = parseThousandths(record.pricePerLiter);
    // 1 millilitro × 1 millesimo di euro/L = 1 milionesimo di euro.
    return { record, milliliters, costMicroEuros: safeInteger(milliliters * priceThousandths) };
  });

  // Con ora sconosciuta, l'odometro ordina gli eventi della stessa giornata.
  // sort opera su una nuova lista, non altera lo storico del chiamante.
  normalized.sort((a, b) => a.record.date.localeCompare(b.record.date)
    || a.record.odometerKm - b.record.odometerKm
    || (a.record.time ?? '').localeCompare(b.record.time ?? ''));
  const latestKnownTime = new Map<string, string>();
  let previous: Refueling | undefined;
  for (const { record } of normalized) {
    if (previous && record.odometerKm < previous.odometerKm) fail('Odometri decrescenti tra le date.');
    const knownTime = latestKnownTime.get(record.date);
    if (record.time !== undefined) {
      if (knownTime !== undefined && record.time < knownTime) fail('Ora e odometro incoerenti.');
      latestKnownTime.set(record.date, record.time);
    }
    previous = record;
  }
  return normalized;
}

function metrics(distanceKm: number, milliliters: number, costMicroEuros: number): ConsumptionMetrics {
  if (distanceKm <= 0) fail('Un intervallo completo deve avere distanza maggiore di zero.');
  const liters = milliliters / 1000;
  const purchaseCostEuros = costMicroEuros / 1_000_000;
  return {
    distanceKm,
    liters,
    litersPer100Km: liters / distanceKm * 100,
    kmPerLiter: distanceKm / liters,
    purchaseCostEuros,
    purchaseCostPerKm: purchaseCostEuros / distanceKm,
  };
}

/** Ricalcola sempre dallo storico, senza valori derivati persistiti o stato globale. */
export function calculateHistory(records: readonly Refueling[]): CalculationResult {
  const normalized = normalize(records);
  const intervals: CompleteInterval[] = [];
  let start: Refueling | null = null;
  let partialIds: string[] = [];
  let pendingMilliliters = 0;
  let pendingCost = 0;
  let totalDistance = 0;
  let totalMilliliters = 0;
  let totalCompleteCost = 0;
  let totalRecordedCost = 0;
  let previousInterval: { distance: number; milliliters: number } | null = null;

  for (const { record, milliliters, costMicroEuros } of normalized) {
    totalRecordedCost = safeInteger(totalRecordedCost + costMicroEuros);
    if (record.breakBefore) {
      start = null;
      partialIds = [];
      pendingMilliliters = 0;
      pendingCost = 0;
    }
    if (start === null) {
      if (record.full) start = record;
      continue;
    }
    pendingMilliliters = safeInteger(pendingMilliliters + milliliters);
    pendingCost = safeInteger(pendingCost + costMicroEuros);
    if (!record.full) {
      partialIds.push(record.id);
      continue;
    }
    const distance = record.odometerKm - start.odometerKm;
    let trend: ConsumptionTrend | null = null;
    if (previousInterval) {
      // Confronto esatto dei rapporti L/km tramite prodotti interi: niente
      // arrotondamenti di visualizzazione o differenze spurie in virgola mobile.
      const difference = BigInt(pendingMilliliters) * BigInt(previousInterval.distance)
        - BigInt(previousInterval.milliliters) * BigInt(distance);
      trend = difference < 0n ? 'improved' : difference > 0n ? 'worse' : 'equal';
    }
    intervals.push({
      trend,
      startId: start.id,
      endId: record.id,
      refuelingIds: [...partialIds, record.id],
      ...metrics(distance, pendingMilliliters, pendingCost),
    });
    previousInterval = { distance, milliliters: pendingMilliliters };
    totalDistance = safeInteger(totalDistance + distance);
    totalMilliliters = safeInteger(totalMilliliters + pendingMilliliters);
    totalCompleteCost = safeInteger(totalCompleteCost + pendingCost);
    start = record;
    partialIds = [];
    pendingMilliliters = 0;
    pendingCost = 0;
  }

  const hasOpenInterval = start !== null && (partialIds.length > 0 || intervals.length === 0
    || intervals.at(-1)?.endId !== start.id);
  return {
    intervals,
    average: intervals.length ? metrics(totalDistance, totalMilliliters, totalCompleteCost) : null,
    totalRecordedCostEuros: totalRecordedCost / 1_000_000,
    status: start === null ? 'no-reference' : hasOpenInterval ? 'awaiting-full' : 'complete',
    openInterval: hasOpenInterval && start ? { startId: start.id, partialIds } : null,
  };
}
