import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getBayWidthsMm, totalShelfWidthMm } from '../../lib/bayWidths';
import {
  A4_PRINTABLE_MM,
  getShelfRowPitchMm,
  hasMissingShelfHeight,
  parsePlacements,
  type Placement,
} from '../../lib/planogramGeometry';
import { supabase } from '../../lib/supabaseClient';
import { PlanogramSvg } from '../planogram/PlanogramSvg';

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
  shelf_height_mm?: number | null;
};

type PlanogramRow = {
  id: string;
  name: string;
  shelf_id: string;
  placements_jsonb: unknown | null;
};

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
  const [imageAspect, setImageAspect] = useState<Record<string, number>>({});
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
          .select('id,name,bay_width_mm,shelf_depth_mm,shelf_count,bay_count,bay_widths_mm,shelf_height_mm')
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

  useEffect(() => {
    let cancelled = false;
    for (const article of articles) {
      if (!article.imageUrl) continue;
      if (imageAspect[article.id] != null) continue;
      const img = new Image();
      img.onload = () => {
        if (cancelled || !img.naturalWidth) return;
        setImageAspect((prev) =>
          prev[article.id] != null
            ? prev
            : { ...prev, [article.id]: img.naturalHeight / img.naturalWidth },
        );
      };
      img.src = article.imageUrl;
    }
    return () => {
      cancelled = true;
    };
  }, [articles, imageAspect]);

  const bayWidthsMm = useMemo(() => {
    if (!shelf) return [1000];
    return getBayWidthsMm(shelf);
  }, [shelf]);

  const shelfWidthMm = totalShelfWidthMm(bayWidthsMm);
  const shelfDepthMm = shelf?.shelf_depth_mm ?? 400;
  const shelfCount = shelf?.shelf_count ?? 1;
  const shelfHeightLimitMm = shelf ? getShelfRowPitchMm(shelf) : null;
  const shelfHeightMissing = shelf ? hasMissingShelfHeight(shelf) : false;

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
      .sort((a, b) => a.bayIndex - b.bayIndex || a.shelfIndex - b.shelfIndex)
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

      {planogramId && loading && <p className="muted">Učitavanje planograma za štampu...</p>}

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
            {shelfHeightLimitMm != null && (
              <div className="metric">
                Visina police: <strong>{shelfHeightLimitMm}</strong> mm
              </div>
            )}
            <div className="metric">
              Razmera: <strong>uklopljeno na A4 landscape ({A4_PRINTABLE_MM.width} x {A4_PRINTABLE_MM.height} mm)</strong>
            </div>
          </div>

          {shelfHeightMissing && (
            <div className="error-text">
              Šablon nema visinu police — unesite je u šablonima polica. Privremeno se koristi podrazumevana visina.
            </div>
          )}

          <div className="print-area">
            <div className="print-svg-wrap">
              <PlanogramSvg
                shelf={shelf}
                placements={placements}
                articlesById={articlesById}
                imageAspect={imageAspect}
                mode="print"
              />
            </div>

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
                          <strong>{item.name}</strong> -{' '}
                          {item.facingsTotal === 1 ? '1 lice' : `${item.facingsTotal} lica`}
                          {item.depthMm
                            ? item.totalUnits && item.rowsDeep && item.rowsDeep > 0
                              ? `, otprilike ${item.totalUnits} kom. (${item.rowsDeep} red${item.rowsDeep !== 1 ? 'a' : ''} dubinski prema dubini police)`
                              : `, dubina ${item.depthMm} mm (dubina police ${shelfDepthMm} mm)`
                            : ` (dubina nije uneta - samo položaji u širini)`}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
