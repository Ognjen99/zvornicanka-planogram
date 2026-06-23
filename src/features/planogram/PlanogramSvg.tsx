import { forwardRef } from 'react';
import type { DragEventHandler, MouseEvent, MouseEventHandler } from 'react';
import {
  A4_PRINTABLE_MM,
  BAY_UPRIGHT_BOTTOM_OVERHANG_MM,
  BAY_UPRIGHT_TOP_OVERHANG_MM,
  BAY_UPRIGHT_WIDTH_MM,
  FIXTURE_TOP_PADDING_MM,
  SHELF_BOARD_THICKNESS_MM,
  SHELF_ROW_LABEL_GUTTER_MM,
  SVG_MARGIN_MM,
  getBayLayoutMm,
  getFixtureBoundsMm,
  getProductRectMm,
  getShelfBaselineYMm,
  getShelfRowPitchMm,
  type Placement,
  type PlanogramArticleSource,
  type PlanogramShelfSource,
} from '../../lib/planogramGeometry';
import { formatArticleDimensionsCompact } from '../../lib/formatArticleDimensions';

export type PlanogramSvgArticle = PlanogramArticleSource & {
  imageUrl?: string;
};

type PlanogramSvgProps = {
  shelf: PlanogramShelfSource;
  placements: Placement[];
  articlesById: Map<string, PlanogramSvgArticle>;
  imageAspect: Record<string, number>;
  mode: 'edit' | 'print';
  showDimensions?: boolean;
  onMouseMove?: MouseEventHandler<SVGSVGElement>;
  onMouseUp?: MouseEventHandler<SVGSVGElement>;
  onMouseLeave?: MouseEventHandler<SVGSVGElement>;
  onDragOver?: DragEventHandler<SVGSVGElement>;
  onDrop?: DragEventHandler<SVGSVGElement>;
  onPlacementMouseDown?: (event: MouseEvent<SVGGElement>, placement: Placement) => void;
  onAddFacing?: (article: PlanogramSvgArticle, shelfIndex: number, bayIndex: number) => void;
  onRemovePlacement?: (placementId: string) => void;
};

export const PlanogramSvg = forwardRef<SVGSVGElement, PlanogramSvgProps>(function PlanogramSvg(
  {
    shelf,
    placements,
    articlesById,
    imageAspect,
    mode,
    showDimensions = false,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
    onDragOver,
    onDrop,
    onPlacementMouseDown,
    onAddFacing,
    onRemovePlacement,
  },
  ref,
) {
  const bounds = getFixtureBoundsMm(shelf);
  const bayLayout = getBayLayoutMm(shelf);
  const rowPitchMm = getShelfRowPitchMm(shelf);
  const contentX = SVG_MARGIN_MM + SHELF_ROW_LABEL_GUTTER_MM;
  const contentY = SVG_MARGIN_MM;
  const isEdit = mode === 'edit';
  const gradientSuffix = mode === 'print' ? 'Print' : '';
  const svgSizeProps =
    mode === 'print'
      ? {
          width: `${A4_PRINTABLE_MM.width}mm`,
          height: `${A4_PRINTABLE_MM.height}mm`,
        }
      : {
          width: '100%',
          height: '100%',
        };

  return (
    <svg
      ref={ref}
      className="svg-canvas"
      viewBox={`0 0 ${bounds.outerWidth} ${bounds.outerHeight}`}
      preserveAspectRatio="xMidYMid meet"
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      {...svgSizeProps}
    >
      <defs>
        <linearGradient id={`shelfGradient${gradientSuffix}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
        <linearGradient id={`productGradient${gradientSuffix}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>

      <g transform={`translate(${SVG_MARGIN_MM} ${SVG_MARGIN_MM})`}>
        {Array.from({ length: shelf.shelf_count }, (_, i) => {
          const y = getShelfBaselineYMm(i, shelf) + SHELF_BOARD_THICKNESS_MM / 2;
          return (
            <text
              key={`shelf-row-label-${mode}-${i}`}
              x={SHELF_ROW_LABEL_GUTTER_MM - 10}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={20}
              fontWeight={600}
              fill="#475569"
            >
              Polica {i + 1}
            </text>
          );
        })}
      </g>

      <g transform={`translate(${contentX} ${contentY})`}>
        {Array.from({ length: shelf.shelf_count }, (_, index) => {
          const y = getShelfBaselineYMm(index, shelf);
          return (
            <g key={`shelf-row-${mode}-${index}`}>
              <rect
                x={0}
                y={y}
                width={bayLayout.totalWidth}
                height={SHELF_BOARD_THICKNESS_MM}
                fill={`url(#shelfGradient${gradientSuffix})`}
                stroke="#64748b"
                strokeWidth={2}
                rx={2}
              />
              <line
                x1={0}
                y1={y}
                x2={bayLayout.totalWidth}
                y2={y}
                stroke="#cbd5e1"
                strokeWidth={2}
                strokeDasharray="10 6"
              />
            </g>
          );
        })}

        {placements.map((placement) => {
          const article = articlesById.get(placement.articleId);
          if (!article) return null;

          const shelfIndex = placement.shelfIndex ?? 0;
          const bayIndex = placement.bayIndex ?? 0;
          const rect = getProductRectMm(placement, article, shelf, bayLayout);
          const rightEdge = placement.xMm + rect.rawWidth;
          const overflow = rightEdge > rect.bayWidth;
          const tooTall = article.height_mm > rowPitchMm;
          const stroke = overflow || tooTall ? '#ef4444' : '#4f46e5';
          const strokeWidth = overflow || tooTall ? 4 : 2;

          return (
            <g
              key={placement.id}
              onMouseDown={isEdit ? (event) => onPlacementMouseDown?.(event, placement) : undefined}
              style={isEdit ? { cursor: 'grab' } : undefined}
            >
              {!article.imageUrl && (
                <rect
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  rx={6}
                  fill={`url(#productGradient${gradientSuffix})`}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                />
              )}
              {article.imageUrl &&
                Array.from({ length: placement.facings }, (_, faceIndex) => {
                  const tileWidth = rect.width / placement.facings;
                  const aspect = imageAspect[article.id];
                  const tileHeight = aspect != null ? tileWidth * aspect : rect.height;
                  return (
                    <image
                      key={`${placement.id}-face-${faceIndex}`}
                      href={article.imageUrl}
                      x={rect.x + faceIndex * tileWidth}
                      y={rect.baselineY - tileHeight}
                      width={tileWidth}
                      height={tileHeight}
                      preserveAspectRatio="none"
                    />
                  );
                })}
              {showDimensions && (
                <text x={rect.x + 8} y={rect.y + 22} fontSize={16} fill="#ffffff">
                  {formatArticleDimensionsCompact(article)}
                </text>
              )}
              {isEdit && (
                <>
                  <rect
                    x={rect.x}
                    y={rect.y - 28}
                    width={32}
                    height={24}
                    rx={4}
                    fill="#10b981"
                    stroke="#047857"
                    strokeWidth={2}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddFacing?.(article, shelfIndex, bayIndex);
                    }}
                  />
                  <text
                    x={rect.x + 16}
                    y={rect.y - 11}
                    fontSize={20}
                    textAnchor="middle"
                    fill="#ffffff"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddFacing?.(article, shelfIndex, bayIndex);
                    }}
                  >
                    +
                  </text>
                  <rect
                    x={rect.x + rect.width - 26}
                    y={rect.y - 20}
                    width={24}
                    height={24}
                    rx={4}
                    fill="#ffffff"
                    stroke="#94a3b8"
                    strokeWidth={2}
                    onClick={() => onRemovePlacement?.(placement.id)}
                  />
                  <text
                    x={rect.x + rect.width - 14}
                    y={rect.y - 2}
                    fontSize={18}
                    textAnchor="middle"
                    fill="#4f46e5"
                    onClick={() => onRemovePlacement?.(placement.id)}
                  >
                    x
                  </text>
                </>
              )}
            </g>
          );
        })}

        {bayLayout.edges.map((x, index) => {
          const topY = FIXTURE_TOP_PADDING_MM - BAY_UPRIGHT_TOP_OVERHANG_MM;
          const height =
            shelf.shelf_count * rowPitchMm +
            SHELF_BOARD_THICKNESS_MM +
            BAY_UPRIGHT_TOP_OVERHANG_MM +
            BAY_UPRIGHT_BOTTOM_OVERHANG_MM;
          return (
            <rect
              key={`bay-bar-${mode}-${index}-${x}`}
              x={x - BAY_UPRIGHT_WIDTH_MM / 2}
              y={topY}
              width={BAY_UPRIGHT_WIDTH_MM}
              height={height}
              fill="#64748b"
              stroke="#334155"
              strokeWidth={2}
              opacity={1}
              pointerEvents="none"
            />
          );
        })}

        <text x={0} y={18} fontSize={16} fill="#475569">
          0 mm
        </text>
        {bayLayout.widths.length > 1 ? (
          bayLayout.widths.map((bayWidth, index) => {
            const centerMm = (bayLayout.starts[index] ?? 0) + bayWidth / 2;
            return (
              <text
                key={`bay-width-label-${mode}-${index}`}
                x={centerMm}
                y={18}
                fontSize={16}
                fontWeight={600}
                textAnchor="middle"
                fill="#1e293b"
              >
                Raf {index + 1}: {bayWidth} mm
              </text>
            );
          })
        ) : (
          <text x={bayLayout.totalWidth / 2} y={18} fontSize={16} fontWeight={600} textAnchor="middle" fill="#1e293b">
            Širina {bayLayout.totalWidth} mm
          </text>
        )}
      </g>
    </svg>
  );
});
