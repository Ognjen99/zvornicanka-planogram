import {
  bayEdgePositionsMm,
  bayStartOffsetsMm,
  getBayWidthsMm,
  totalShelfWidthMm,
} from './bayWidths';

export type PlanogramShelfSource = {
  bay_width_mm: number;
  shelf_count: number;
  bay_count?: number | null;
  bay_widths_mm?: unknown | null;
  shelf_height_mm?: number | null;
};

export type PlanogramArticleSource = {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
};

export type Placement = {
  id: string;
  articleId: string;
  bayIndex: number;
  shelfIndex: number;
  xMm: number;
  facings: number;
};

export type BayLayoutMm = {
  widths: number[];
  starts: number[];
  edges: number[];
  totalWidth: number;
};

export type FixtureBoundsMm = {
  contentWidth: number;
  contentHeight: number;
  outerWidth: number;
  outerHeight: number;
  rowPitch: number;
};

export type ProductRectMm = {
  x: number;
  y: number;
  width: number;
  height: number;
  rawWidth: number;
  baselineY: number;
  bayWidth: number;
};

export const DEFAULT_SHELF_ROW_MM = 250;
export const A4_PRINTABLE_MM = { width: 277, height: 170 };
export const SVG_MARGIN_MM = 30;
export const SHELF_ROW_LABEL_GUTTER_MM = 110;
export const FIXTURE_TOP_PADDING_MM = 30;
export const FIXTURE_BOTTOM_PADDING_MM = 30;
export const SHELF_BOARD_THICKNESS_MM = 8;
export const BAY_UPRIGHT_WIDTH_MM = 12;
export const BAY_UPRIGHT_TOP_OVERHANG_MM = 24;
export const BAY_UPRIGHT_BOTTOM_OVERHANG_MM = 14;
export const VISUAL_GAP_MM = 4;

export function parsePlacements(value: unknown): Placement[] {
  if (!value || !Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const obj = item as Partial<Placement>;
      if (!obj.articleId) return null;
      return {
        id: obj.id ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`),
        articleId: String(obj.articleId),
        bayIndex: typeof obj.bayIndex === 'number' ? obj.bayIndex : 0,
        shelfIndex: typeof obj.shelfIndex === 'number' ? obj.shelfIndex : 0,
        xMm: typeof obj.xMm === 'number' ? obj.xMm : 0,
        facings: typeof obj.facings === 'number' && obj.facings > 0 ? obj.facings : 1,
      };
    })
    .filter((x): x is Placement => Boolean(x));
}

export function getShelfRowPitchMm(shelf: PlanogramShelfSource | null | undefined): number {
  const raw = Number(shelf?.shelf_height_mm);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SHELF_ROW_MM;
}

export function hasMissingShelfHeight(shelf: PlanogramShelfSource | null | undefined): boolean {
  return shelf?.shelf_height_mm == null || !Number.isFinite(Number(shelf.shelf_height_mm)) || Number(shelf.shelf_height_mm) <= 0;
}

export function getBayLayoutMm(shelf: PlanogramShelfSource): BayLayoutMm {
  const widths = getBayWidthsMm(shelf);
  return {
    widths,
    starts: bayStartOffsetsMm(widths),
    edges: bayEdgePositionsMm(widths),
    totalWidth: totalShelfWidthMm(widths),
  };
}

export function getFixtureBoundsMm(shelf: PlanogramShelfSource): FixtureBoundsMm {
  const { totalWidth } = getBayLayoutMm(shelf);
  const rowPitch = getShelfRowPitchMm(shelf);
  const contentHeight =
    FIXTURE_TOP_PADDING_MM +
    shelf.shelf_count * rowPitch +
    SHELF_BOARD_THICKNESS_MM +
    FIXTURE_BOTTOM_PADDING_MM;

  return {
    contentWidth: totalWidth,
    contentHeight,
    outerWidth: totalWidth + SHELF_ROW_LABEL_GUTTER_MM + SVG_MARGIN_MM * 2,
    outerHeight: contentHeight + SVG_MARGIN_MM * 2,
    rowPitch,
  };
}

export function getShelfBaselineYMm(shelfIndex: number, shelf: PlanogramShelfSource): number {
  const rowPitch = getShelfRowPitchMm(shelf);
  const clampedIndex = Math.max(0, Math.min(shelf.shelf_count - 1, shelfIndex));
  return FIXTURE_TOP_PADDING_MM + (shelf.shelf_count - clampedIndex) * rowPitch;
}

export function getShelfIndexAtContentYMm(yMm: number, shelf: PlanogramShelfSource): number {
  const rowPitch = getShelfRowPitchMm(shelf);
  const rawIndex = shelf.shelf_count - (yMm - FIXTURE_TOP_PADDING_MM) / rowPitch;
  const rounded = Math.round(rawIndex);
  return Math.max(0, Math.min(shelf.shelf_count - 1, rounded));
}

export function getProductRectMm(
  placement: Placement,
  article: PlanogramArticleSource,
  shelf: PlanogramShelfSource,
  bayLayout: BayLayoutMm,
): ProductRectMm {
  const facings = placement.facings ?? 1;
  const bayIndex = placement.bayIndex ?? 0;
  const bayStart = bayLayout.starts[bayIndex] ?? 0;
  const bayWidth = bayLayout.widths[bayIndex] ?? shelf.bay_width_mm;
  const rawWidth = article.width_mm * facings;
  const visualGap = Math.min(VISUAL_GAP_MM, Math.max(0, rawWidth - 1));
  const width = Math.max(1, rawWidth - visualGap);
  const x = bayStart + placement.xMm + visualGap / 2;
  const baselineY = getShelfBaselineYMm(placement.shelfIndex ?? 0, shelf);

  return {
    x,
    y: baselineY - article.height_mm,
    width,
    height: article.height_mm,
    rawWidth,
    baselineY,
    bayWidth,
  };
}

export function getFittedPxPerMm(
  bounds: FixtureBoundsMm,
  containerSize: { width: number; height: number } | null | undefined,
): number | null {
  if (!containerSize || containerSize.width <= 0 || containerSize.height <= 0) {
    return null;
  }

  return Math.min(containerSize.width / bounds.outerWidth, containerSize.height / bounds.outerHeight);
}
