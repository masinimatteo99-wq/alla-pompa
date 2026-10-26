import { describe, expect, it } from 'vitest';
import { calculateHistory, InvalidHistoryError, parseThousandths } from '../src/domain/calculations';
import type { Refueling } from '../src/domain/models';

function fuel(id: string, odometerKm: number, liters = '40', full = true,
  pricePerLiter = '1.750', extra: Partial<Refueling> = {}): Refueling {
  return { id, date: '2026-01-01', odometerKm, liters, full, pricePerLiter, ...extra };
}

describe('Andamento rispetto all’intervallo completo precedente', () => {
  it('distingue miglioramento, peggioramento e uguaglianza anche con distanze diverse e parziali', () => {
    const result = calculateHistory([
      fuel('a', 0, '20'), fuel('b', 100, '10'), fuel('p', 150, '4', false),
      fuel('c', 200, '4'), fuel('d', 300, '12'), fuel('e', 500, '24'),
    ]);
    expect(result.intervals.map((interval) => interval.trend)).toEqual([null, 'improved', 'worse', 'equal']);
    expect(result.intervals.map((interval) => interval.litersPer100Km)).toEqual([10, 8, 12, 12]);
  });

  it('riconosce uguaglianze matematiche senza errori decimali', () => {
    const result = calculateHistory([
      fuel('a', 0), fuel('b', 100, '0.1'), fuel('c', 400, '0.3'),
    ]);
    expect(result.intervals[1]?.trend).toBe('equal');
  });

  it('non confronta valori arrotondati e aggiorna l’indicatore dopo una modifica', () => {
    const history = [fuel('a', 0), fuel('b', 1000, '50'), fuel('c', 2000, '50.001')];
    const result = calculateHistory(history);
    expect(result.intervals[0]!.litersPer100Km.toFixed(2)).toBe(result.intervals[1]!.litersPer100Km.toFixed(2));
    expect(result.intervals[1]?.trend).toBe('worse');
    expect(calculateHistory([history[0]!, history[1]!, { ...history[2]!, liters: '49.999' }]).intervals[1]?.trend).toBe('improved');
  });
});

describe('Esempi del piano', () => {
  it('A: esclude il pieno iniziale e calcola consumo, rendimento e costo', () => {
    const result = calculateHistory([fuel('a', 50_000, '60', true, '2'), fuel('b', 50_650)]);
    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0]).toMatchObject({
      startId: 'a', endId: 'b', refuelingIds: ['b'], distanceKm: 650,
      liters: 40, kmPerLiter: 16.25, purchaseCostEuros: 70,
    });
    expect(result.average?.litersPer100Km).toBeCloseTo(6.153846153846, 10);
    expect(result.average?.purchaseCostPerKm).toBeCloseTo(0.107692307692, 10);
    expect(result.totalRecordedCostEuros).toBe(190);
  });

  it('B: somma parziali e pieno finale, con prezzi diversi', () => {
    const result = calculateHistory([
      fuel('a', 10_000), fuel('p', 10_300, '15', false, '1.80'),
      fuel('b', 10_700, '30', true, '1.70'),
    ]);
    expect(result.intervals[0]).toMatchObject({
      distanceKm: 700, liters: 45, purchaseCostEuros: 78, refuelingIds: ['p', 'b'],
    });
    expect(result.average?.litersPer100Km).toBeCloseTo(6.428571428571, 10);
    expect(result.average?.purchaseCostPerKm).toBeCloseTo(0.111428571428, 10);
  });

  it.each([
    ['vuoto', []],
    ['solo pieno', [fuel('a', 100)]],
    ['soli parziali', [fuel('p', 100, '10', false), fuel('q', 200, '5', false)]],
  ] as const)('C: %s restituisce consumo non disponibile, non zero', (_name, history) => {
    const result = calculateHistory(history);
    expect(result.average).toBeNull();
    expect(result.intervals).toEqual([]);
  });
});

describe('Intervalli e medie', () => {
  it('attende il pieno finale e conserva la spesa dei parziali', () => {
    const result = calculateHistory([fuel('a', 100, '20'), fuel('p', 200, '10', false)]);
    expect(result.status).toBe('awaiting-full');
    expect(result.openInterval).toEqual({ startId: 'a', partialIds: ['p'] });
    expect(result.average).toBeNull();
    expect(result.totalRecordedCostEuros).toBe(52.5);
  });

  it('usa i rapporti dei totali, non la media aritmetica dei singoli consumi', () => {
    const result = calculateHistory([
      fuel('a', 0), fuel('b', 100, '10', true, '2'),
      fuel('c', 1_000, '45', true, '1'), fuel('p', 1_100, '20', false, '3'),
    ]);
    expect(result.intervals.map((interval) => interval.litersPer100Km)).toEqual([10, 5]);
    expect(result.average?.litersPer100Km).toBe(5.5);
    expect(result.average?.kmPerLiter).toBeCloseTo(1000 / 55, 12);
    expect(result.average?.purchaseCostEuros).toBe(65);
    expect(result.average?.purchaseCostPerKm).toBe(0.065);
    expect(result.status).toBe('awaiting-full');
  });

  it('gestisce più parziali e non conteggia due volte il pieno di confine', () => {
    const result = calculateHistory([
      fuel('a', 0), fuel('p1', 100, '5', false), fuel('p2', 200, '7', false),
      fuel('b', 400, '8'), fuel('c', 800, '20'),
    ]);
    expect(result.intervals.map((interval) => interval.liters)).toEqual([20, 20]);
    expect(result.average?.liters).toBe(40);
    expect(result.status).toBe('complete');
  });

  it('ignora i parziali precedenti al primo riferimento solo per i consumi', () => {
    const result = calculateHistory([
      fuel('p', 0, '5', false), fuel('a', 100, '30'), fuel('b', 500, '20'),
    ]);
    expect(result.average?.liters).toBe(20);
    expect(result.average?.distanceKm).toBe(400);
    expect(result.totalRecordedCostEuros).toBe(96.25);
  });

  it('esclude un intervallo interrotto e riparte dal successivo pieno', () => {
    const result = calculateHistory([
      fuel('a', 0), fuel('b', 400, '20'), fuel('p', 500, '8', false),
      fuel('gap', 600, '9', false, '2', { breakBefore: true }),
      fuel('c', 800, '30'), fuel('d', 1_200, '24'),
    ]);
    expect(result.intervals.map((interval) => [interval.startId, interval.endId])).toEqual([
      ['a', 'b'], ['c', 'd'],
    ]);
    expect(result.average?.distanceKm).toBe(800);
    expect(result.average?.liters).toBe(44);
    expect(result.average?.litersPer100Km).toBe(5.5);
  });

  it('un pieno con interruzione diventa subito un nuovo riferimento', () => {
    const result = calculateHistory([
      fuel('a', 0), fuel('b', 400, '20', true, '2', { breakBefore: true }),
      fuel('c', 800, '24'),
    ]);
    expect(result.intervals.map((interval) => interval.startId)).toEqual(['b']);
  });

  it('dopo interruzione senza nuovo pieno non inventa un riferimento', () => {
    const result = calculateHistory([
      fuel('a', 0), fuel('b', 400, '20'),
      fuel('p', 500, '8', false, '2', { breakBefore: true }),
    ]);
    expect(result.status).toBe('no-reference');
    expect(result.openInterval).toBeNull();
    expect(result.average?.litersPer100Km).toBe(5);
  });

  it('ricalcola dopo modifica e cancellazione di una registrazione errata', () => {
    const a = fuel('a', 0);
    const p = fuel('p', 100, '10', false);
    const b = fuel('b', 400, '20');
    expect(calculateHistory([a, p, b]).average?.litersPer100Km).toBe(7.5);
    expect(calculateHistory([a, { ...p, liters: '12' }, b]).average?.litersPer100Km).toBe(8);
    expect(calculateHistory([a, b]).average?.litersPer100Km).toBe(5);
    expect(calculateHistory([p, b]).average).toBeNull();
  });

  it('ordina lo storico senza modificarlo e conserva il risultato dopo JSON round-trip', () => {
    const history = Object.freeze([Object.freeze(fuel('b', 500)), Object.freeze(fuel('a', 0))]);
    const result = calculateHistory(history);
    expect(result.intervals[0]?.startId).toBe('a');
    expect(history[0]?.id).toBe('b');
    expect(calculateHistory(JSON.parse(JSON.stringify(history)) as Refueling[])).toEqual(result);
  });
});

describe('Precisione numerica e validazione', () => {
  it('accetta virgola e punto e conserva tre decimali', () => {
    expect(parseThousandths(' 1,759 ')).toBe(1759);
    expect(parseThousandths('37.08')).toBe(37080);
    expect(parseThousandths('0.001')).toBe(1);
    const result = calculateHistory([fuel('a', 0), fuel('b', 600, '32,125', true, '1,759')]);
    expect(result.average?.purchaseCostEuros).toBe(56.507875);
    expect(result.average?.litersPer100Km).toBeCloseTo(5.354166666666, 10);
  });

  it('somma gli importi senza arrotondare ogni singolo rifornimento ai centesimi', () => {
    const result = calculateHistory([
      fuel('a', 0), fuel('p', 100, '0.001', false, '1.001'),
      fuel('b', 200, '0.001', true, '1.001'),
    ]);
    expect(result.average?.purchaseCostEuros).toBe(0.002002);
  });

  it('accetta prezzo zero e parziali allo stesso odometro', () => {
    const result = calculateHistory([
      fuel('a', 100), fuel('p', 100, '5', false, '0'), fuel('b', 200, '5', true, '0'),
    ]);
    expect(result.average?.litersPer100Km).toBe(10);
    expect(result.average?.purchaseCostPerKm).toBe(0);
  });

  it.each(['-1', 'NaN', 'Infinity', '1e3', '1.0001', '', '1,2.3', '1.000,50']) (
    'rifiuta il decimale non supportato %s', (input) => {
      expect(() => parseThousandths(input)).toThrow(InvalidHistoryError);
    },
  );

  it.each([
    { liters: '0' }, { pricePerLiter: '-1' }, { odometerKm: -1 },
    { odometerKm: NaN }, { odometerKm: Infinity }, { odometerKm: 1.5 },
    { date: '2026-02-30' }, { date: '19/10/2026' }, { time: '24:00' },
    { id: '' }, { liters: '999999999999999999' },
    { liters: '1000000000', pricePerLiter: '1000000000' },
  ])('rifiuta registrazioni non valide: %j', (extra) => {
    expect(() => calculateHistory([fuel('a', 0, '20', true, '2', extra)])).toThrow(InvalidHistoryError);
  });

  it('rifiuta identificativi duplicati', () => {
    expect(() => calculateHistory([fuel('a', 0), fuel('a', 500)])).toThrow(/univoco/);
  });

  it('rifiuta un intervallo completo a distanza zero', () => {
    expect(() => calculateHistory([fuel('a', 100), fuel('b', 100)])).toThrow(/distanza/);
  });

  it('rifiuta odometri che diminuiscono tra date diverse', () => {
    expect(() => calculateHistory([
      fuel('a', 500), fuel('b', 100, '20', true, '2', { date: '2026-01-02' }),
    ])).toThrow(/decrescenti/);
  });

  it('rifiuta orari incompatibili con la progressione del contachilometri', () => {
    expect(() => calculateHistory([
      fuel('a', 0, '20', true, '2', { time: '18:00' }),
      fuel('b', 100, '10', false),
      fuel('c', 200, '20', true, '2', { time: '12:00' }),
    ])).toThrow(/incoerenti/);
  });
});
