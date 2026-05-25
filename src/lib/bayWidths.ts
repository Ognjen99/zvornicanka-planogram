/** Shelf row fields required to resolve per-bay widths. */
export type ShelfBayWidthSource = {
  bay_width_mm: number;
  bay_count?: number | null;
  bay_widths_mm?: unknown | null;
};

/**
 * Ordered bay widths in mm: either from `bay_widths_mm` or `bay_width_mm` repeated `bay_count` times.
 */
export function getBayWidthsMm(shelf: ShelfBayWidthSource): number[] {
  const raw = shelf.bay_widths_mm;
  if (Array.isArray(raw) && raw.length > 0) {
    const nums = raw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length === raw.length) {
      return nums;
    }
  }
  const w = Number(shelf.bay_width_mm);
  const c = shelf.bay_count == null || shelf.bay_count < 1 ? 1 : shelf.bay_count;
  const safeW = Number.isFinite(w) && w > 0 ? w : 1000;
  return Array.from({ length: c }, () => safeW);
}

export function totalShelfWidthMm(widths: number[]): number {
  return widths.reduce((a, b) => a + b, 0);
}

/** Cumulative start (mm) for each bay index; same length as widths. */
export function bayStartOffsetsMm(widths: number[]): number[] {
  const starts: number[] = [];
  let acc = 0;
  for (const w of widths) {
    starts.push(acc);
    acc += w;
  }
  return starts;
}

/** X positions (same unit as mm) of vertical dividers: [0, w0, w0+w1, ...]. */
export function bayEdgePositionsMm(widths: number[]): number[] {
  const edges: number[] = [0];
  for (const w of widths) {
    edges.push(edges[edges.length - 1] + w);
  }
  return edges;
}

/** Bay index for an absolute X (mm) along the shelf from the left edge. */
export function bayIndexAtAbsoluteMm(absMm: number, widths: number[]): number {
  if (widths.length === 0) return 0;
  const total = totalShelfWidthMm(widths);
  if (absMm <= 0) return 0;
  if (absMm >= total) return widths.length - 1;
  let acc = 0;
  for (let i = 0; i < widths.length; i++) {
    acc += widths[i];
    if (absMm < acc) return i;
  }
  return widths.length - 1;
}

export function hasCustomBayWidths(shelf: ShelfBayWidthSource): boolean {
  return Array.isArray(shelf.bay_widths_mm) && shelf.bay_widths_mm.length > 0;
}
