import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  bayEdgePositionsMm,
  bayStartOffsetsMm,
  getBayWidthsMm,
  totalShelfWidthMm,
} from '../../lib/bayWidths';
import { supabase } from '../../lib/supabaseClient';

const ARTICLE_IMAGE_BUCKET = 'article-images';

type ArticleRow = {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  depth_mm: number | null;
  image_path: string | null;
  imageUrl?: string;
};

type ShelfRow = {
  id: string;
  name: string;
  bay_width_mm: number;
  shelf_depth_mm: number;
  shelf_count: number;
  bay_count?: number | null;
  bay_widths_mm?: unknown | null;
};

type PlanogramRow = {
  id: string;
  name: string;
  shelf_id: string;
  placements_jsonb: unknown | null;
};

type Placement = {
  id: string;
  articleId: string;
  bayIndex: number;
  shelfIndex: number;
  xMm: number;
  facings: number;
};

// Extra visual spacing between products in the SVG (pixels at base scale), purely cosmetic.
const VISUAL_GAP_PX = 3;
const SVG_MARGIN_PX_BASE = 20;
const SHELF_ROW_LABEL_GUTTER_PX_BASE = 54;

function parsePlacements(value: unknown): Placement[] {
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

export function PrintViewPage() {
  const location = useLocation();
  const planogramId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('planogramId');
  }, [location.search]);

  const [planogram, setPlanogram] = useState<PlanogramRow | null>(null);
  const [shelf, setShelf] = useState<ShelfRow | null>(null);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!planogramId) {
      setLoading(false);
      return;
    }

    void loadData(planogramId);
  }, [planogramId]);

  const loadData = async (id: string) => {
    setLoading(true);
    setError(null);

    try {
      const { data: planogramRow, error: planogramError } = await supabase
        .from('planograms')
        .select('id,name,shelf_id,placements_jsonb')
        .eq('id', id)
        .single();

      if (planogramError) {
        throw planogramError;
      }

      const planRow = planogramRow as PlanogramRow;

      const [{ data: shelfRow, error: shelfError }, { data: articleRows, error: articlesError }] = await Promise.all([
        supabase
          .from('shelves')
          .select('id,name,bay_width_mm,shelf_depth_mm,shelf_count,bay_count,bay_widths_mm')
          .eq('id', planRow.shelf_id)
          .single(),
        supabase.from('articles').select('id,name,width_mm,height_mm,depth_mm,image_path'),
      ]);

      if (shelfError) throw shelfError;
      if (articlesError) throw articlesError;

      const rawArticles = (articleRows ?? []) as ArticleRow[];

      const articlesWithImages: ArticleRow[] = await Promise.all(
        rawArticles.map(async (row) => {
          if (!row.image_path) return row;
          try {
            const { data: signed, error: signedError } = await supabase.storage
              .from(ARTICLE_IMAGE_BUCKET)
              .createSignedUrl(row.image_path, 86400);
            if (signedError || !signed?.signedUrl) return row;
            return { ...row, imageUrl: signed.signedUrl };
          } catch {
            return row;
          }
        }),
      );

      setPlanogram(planRow);
      setShelf(shelfRow as ShelfRow);
      setArticles(articlesWithImages);
      setPlacements(parsePlacements(planRow.placements_jsonb));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neuspešno učitavanje planograma za štampu.');
    } finally {
      setLoading(false);
    }
  };

  const articlesById = useMemo(() => {
    const map = new Map<string, ArticleRow>();
    for (const article of articles) {
      map.set(article.id, article);
    }
    return map;
  }, [articles]);

  const bayWidthsMm = useMemo(() => {
    if (!shelf) return [1000];
    return getBayWidthsMm(shelf);
  }, [shelf]);

  const bayStartsMm = useMemo(() => bayStartOffsetsMm(bayWidthsMm), [bayWidthsMm]);

  const shelfWidthMm = totalShelfWidthMm(bayWidthsMm);
  const shelfDepthMm = shelf?.shelf_depth_mm ?? 400;
  const shelfCount = shelf?.shelf_count ?? 1;

  // Base scale in px per mm, then shrink to fit a typical printable width
  const basePxPerMm = 1;
  const baseSvgMarginPx = SVG_MARGIN_PX_BASE * 2;
  const baseLabelGutterPx = SHELF_ROW_LABEL_GUTTER_PX_BASE;
  const baseWidthPx = shelfWidthMm * basePxPerMm + baseSvgMarginPx + baseLabelGutterPx;
  const maxPrintWidthPx = 700;
  const scale = baseWidthPx > maxPrintWidthPx ? maxPrintWidthPx / baseWidthPx : 1;
  const pxPerMm = basePxPerMm * scale;

  const shelfWidthPx = shelfWidthMm * pxPerMm;
  const bayEdgesPx = useMemo(
    () => bayEdgePositionsMm(bayWidthsMm).map((mm) => mm * pxPerMm),
    [bayWidthsMm, pxPerMm],
  );
  const shelfHeightPx = 12 * scale;
  const shelfSpacingPx = 80 * scale;
  const bayHeightPx = 60 * scale + shelfCount * shelfSpacingPx;
  const svgMarginPx = SVG_MARGIN_PX_BASE * scale;
  const shelfLabelGutterPx = SHELF_ROW_LABEL_GUTTER_PX_BASE * scale;
  const svgOuterWidthPx = shelfWidthPx + svgMarginPx * 2 + shelfLabelGutterPx;
  const svgOuterHeightPx = bayHeightPx + svgMarginPx * 2;

  const bayShelfSummaries = useMemo(() => {
    if (!planogram || !shelf) return [];

    const shelfDepthMmValue = shelf.shelf_depth_mm ?? 0;

    const groupMap = new Map<
      string,
      {
        bayIndex: number;
        shelfIndex: number;
        articles: Map<
          string,
          {
            articleId: string;
            name: string;
            facingsTotal: number;
            depthMm: number | null;
          }
        >;
      }
    >();

    for (const placement of placements) {
      const article = articlesById.get(placement.articleId);
      if (!article) continue;

      const bayIndex = placement.bayIndex ?? 0;
      const shelfIndex = placement.shelfIndex ?? 0;
      const key = `${bayIndex}-${shelfIndex}`;

      let group = groupMap.get(key);
      if (!group) {
        group = {
          bayIndex,
          shelfIndex,
          articles: new Map(),
        };
        groupMap.set(key, group);
      }

      const existing =
        group.articles.get(article.id) ??
        {
          articleId: article.id,
          name: article.name,
          facingsTotal: 0,
          depthMm: article.depth_mm,
        };

      existing.facingsTotal += placement.facings ?? 1;
      existing.depthMm = article.depth_mm;
      group.articles.set(article.id, existing);
    }

    const result = Array.from(groupMap.values())
      .sort((a, b) => a.shelfIndex - b.shelfIndex || a.bayIndex - b.bayIndex)
      .map((group) => {
        const items = Array.from(group.articles.values()).map((item) => {
          let rowsDeep: number | null = null;
          let totalUnits: number | null = null;

          if (item.depthMm && item.depthMm > 0 && shelfDepthMmValue > 0) {
            rowsDeep = Math.floor(shelfDepthMmValue / item.depthMm);
            if (rowsDeep > 0) {
              totalUnits = rowsDeep * item.facingsTotal;
            }
          }

          return { ...item, rowsDeep, totalUnits };
        });

        return {
          bayIndex: group.bayIndex,
          shelfIndex: group.shelfIndex,
          items,
        };
      });

    return result;
  }, [planogram, shelf, placements, articlesById]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="panel stack-v">
      <div className="panel-header">
        <div className="stack-v">
          <div className="panel-title">Pregled štampe A4</div>
          <div className="panel-subtitle">
            Prikaz izabranog planograma pod stalnom razmerom koja staje na A4 list. Za PDF ili štampač koristite dijalog
            za štampu pregledača.
          </div>
        </div>
        <div className="stack-h">
          <span className="badge">Šema za štampu</span>
          <button type="button" className="btn-ghost" onClick={handlePrint} disabled={!planogram || loading}>
            Štampa
          </button>
        </div>
      </div>

      {!planogramId && (
        <p className="muted">
          Nije izabran planogram. U uređivaču planograma izaberite raspored pa koristite dugme{' '}
          <strong>Štampa A4</strong>.
        </p>
      )}

      {planogramId && loading && <p className="muted">Učitavanje planograma za štampu…</p>}

      {error && <p className="error-text">{error}</p>}

      {planogram && shelf && !loading && !error && (
        <>
          <div className="metric-row">
            <div className="metric">
              Planogram: <strong>{planogram.name}</strong>
            </div>
            <div className="metric">
              Šablon police: <strong>{shelf.name}</strong>
            </div>
            <div className="metric">
              Širina <strong>{shelfWidthMm}</strong> mm · Dubina <strong>{shelfDepthMm}</strong> mm · Police{' '}
              <strong>{shelfCount}</strong>
            </div>
          </div>

          <svg
            className="svg-canvas"
            width={svgOuterWidthPx}
            height={svgOuterHeightPx}
            viewBox={`0 0 ${svgOuterWidthPx} ${svgOuterHeightPx}`}
          >
            <defs>
              <linearGradient id="shelfGradientPrint" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#e2e8f0" />
                <stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>
              <linearGradient id="productGradientPrint" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="#818cf8" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
            </defs>

            <g transform={`translate(${svgMarginPx} ${svgMarginPx})`}>
              {Array.from({ length: shelfCount }, (_, i) => {
                const y = bayHeightPx - shelfHeightPx - i * shelfSpacingPx;
                const cy = y + shelfHeightPx / 2;
                return (
                  <text
                    key={`shelf-row-label-print-${i}`}
                    x={shelfLabelGutterPx - 6 * scale}
                    y={cy}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fontSize={11 * scale}
                    fontWeight={600}
                    fill="#475569"
                  >
                    Polica {i + 1}
                  </text>
                );
              })}
              <g transform={`translate(${shelfLabelGutterPx} 0)`}>
              {/* Vertical bay bars including outer uprights */}
              {bayEdgesPx.map((x, index) => {
                const topOverhangPx = 20 * scale;
                const bottomOverhangPx = 8 * scale;
                const topY =
                  bayHeightPx - shelfHeightPx - (shelfCount - 1) * shelfSpacingPx - topOverhangPx;
                const height =
                  shelfHeightPx + (shelfCount - 1) * shelfSpacingPx + topOverhangPx + bottomOverhangPx;
                return (
                  <rect
                    key={`bay-bar-print-${index}-${x}`}
                    x={x - 4 * scale}
                    y={topY}
                    width={8 * scale}
                    height={height}
                    fill="#64748b"
                    stroke="#334155"
                    strokeWidth={1.25 * scale}
                    opacity={1}
                  />
                );
              })}

              {Array.from({ length: shelfCount }, (_, index) => {
                const y = bayHeightPx - shelfHeightPx - index * shelfSpacingPx;
                return (
                  <g key={index}>
                    <rect
                      x={0}
                      y={y}
                      width={shelfWidthPx}
                      height={shelfHeightPx}
                      fill="url(#shelfGradientPrint)"
                      stroke="#64748b"
                      strokeWidth={1 * scale}
                      rx={6 * scale}
                    />
                    <line
                      x1={0}
                      y1={y}
                      x2={shelfWidthPx}
                      y2={y}
                      stroke="#cbd5e1"
                      strokeWidth={1 * scale}
                      strokeDasharray={`${4 * scale} ${2 * scale}`}
                    />
                  </g>
                );
              })}

              {placements.map((placement) => {
                const article = articlesById.get(placement.articleId);
                if (!article) return null;

                const shelfIndex = placement.shelfIndex ?? 0;
                const baseY = bayHeightPx - shelfHeightPx - shelfIndex * shelfSpacingPx;

                const widthMm = article.width_mm * placement.facings;
                const heightMm = article.height_mm;
                const bayStartMm = bayStartsMm[placement.bayIndex ?? 0] ?? 0;
                const rawX = (placement.xMm + bayStartMm) * pxPerMm;
                const rawWidth = widthMm * pxPerMm;
                const visualGap = VISUAL_GAP_PX * scale;
                const widthPx = Math.max(1, rawWidth - visualGap);
                const xPx = rawX + visualGap / 2;
                const heightPx = heightMm * pxPerMm;
                const yPx = baseY - heightPx;

                return (
                  <g key={placement.id}>
                    {!article.imageUrl && (
                      <rect
                        x={xPx}
                        y={yPx}
                        width={widthPx}
                        height={heightPx}
                        rx={4 * scale}
                        fill="url(#productGradientPrint)"
                        stroke="#4f46e5"
                        strokeWidth={1 * scale}
                      />
                    )}
                    {article.imageUrl && (
                      <image
                        href={article.imageUrl}
                        x={xPx}
                        y={yPx}
                        width={widthPx}
                        height={heightPx}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    )}
                  </g>
                );
              })}

              <text x={4} y={12 * scale} fontSize={9 * scale} fill="#475569">
                0 mm
              </text>
              <text x={shelfWidthPx - 40 * scale} y={12 * scale} fontSize={9 * scale} fill="#475569">
                {shelfWidthMm} mm
              </text>
              </g>
            </g>
          </svg>

          {bayShelfSummaries.length > 0 && (
            <div className="planogram-summary">
              {bayShelfSummaries.map((group) => (
                <div key={`${group.bayIndex}-${group.shelfIndex}`} className="planogram-summary-group">
                  <div className="planogram-summary-title">
                    Raf {group.bayIndex + 1}
                    {bayWidthsMm[group.bayIndex] != null && (
                      <>
                        {' '}
                        (<strong>{bayWidthsMm[group.bayIndex]}</strong> mm)
                      </>
                    )}
                    , polica {group.shelfIndex + 1}
                  </div>
                  <ul className="planogram-summary-list">
                    {group.items.map((item) => (
                      <li key={item.articleId}>
                        <strong>{item.name}</strong> –{' '}
                        {item.facingsTotal === 1 ? '1 lice' : `${item.facingsTotal} lica`}
                        {item.depthMm
                          ? item.totalUnits && item.rowsDeep && item.rowsDeep > 0
                            ? `, otprilike ${item.totalUnits} kom. (${item.rowsDeep} red${item.rowsDeep !== 1 ? 'a' : ''} dubinski prema dubini police)`
                            : `, dubina ${item.depthMm} mm (dubina police ${shelfDepthMm} mm)`
                          : ` (dubina nije uneta — samo položaji u širini)`}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}


