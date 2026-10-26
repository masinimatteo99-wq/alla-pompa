/** Valori decimali in ingresso come testo, senza conversioni binarie anticipate. */
export interface Refueling {
  readonly id: string;
  /** Data locale YYYY-MM-DD; l'ora ignota non viene inventata. */
  readonly date: string;
  readonly time?: string;
  readonly odometerKm: number;
  readonly liters: string;
  readonly pricePerLiter: string;
  readonly full: boolean;
  /** Storico incompleto prima di questa registrazione: interrompe la misurazione. */
  readonly breakBefore?: boolean;
}

export interface Vehicle {
  readonly id: string;
  readonly name: string;
  readonly tankCapacityLiters?: number;
}

export interface ConsumptionMetrics {
  readonly distanceKm: number;
  readonly liters: number;
  readonly litersPer100Km: number;
  readonly kmPerLiter: number;
  readonly purchaseCostEuros: number;
  readonly purchaseCostPerKm: number;
}

export type ConsumptionTrend = 'improved' | 'worse' | 'equal';

export interface CompleteInterval extends ConsumptionMetrics {
  readonly trend: ConsumptionTrend | null;
  readonly startId: string;
  readonly endId: string;
  /** Esclude il pieno iniziale, include il pieno finale e i parziali. */
  readonly refuelingIds: readonly string[];
}

export interface CalculationResult {
  readonly intervals: readonly CompleteInterval[];
  readonly average: ConsumptionMetrics | null;
  /** Include anche rifornimenti precedenti al riferimento e intervalli aperti. */
  readonly totalRecordedCostEuros: number;
  readonly status: 'no-reference' | 'awaiting-full' | 'complete';
  readonly openInterval: {
    readonly startId: string;
    readonly partialIds: readonly string[];
  } | null;
}
