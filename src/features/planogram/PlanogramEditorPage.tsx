import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  bayEdgePositionsMm,
  bayIndexAtAbsoluteMm,
  bayStartOffsetsMm,
  getBayWidthsMm,
  totalShelfWidthMm,
} from '../../lib/bayWidths';
import { supabase } from '../../lib/supabaseClient';
import { formatArticleDimensionsCompact } from '../../lib/formatArticleDimensions';
import { useArticleTaxonomy } from '../articles/useArticleTaxonomy';

type ArticleRow = {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  depth_mm: number | null;
  image_path: string | null;
  imageUrl?: string;
  group_name: string | null;
  subgroup_name: string | null;
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

type Placement = {
  id: string;
  articleId: string;
  bayIndex: number;
  shelfIndex: number;
  xMm: number;
  facings: number;
};

type LoadedPlanogram = {
  row: PlanogramRow;
  placements: Placement[];
};

const BASE_PX_PER_MM = 0.6;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
const MARGIN_MM = 5;
const ARTICLE_BUCKET = 'article-images';
const ARTICLE_SELECT = 'id,name,width_mm,height_mm,depth_mm,image_path,group_name,subgroup_name';
const GRID_MM = 5;
const MIN_GAP_MM = 1;
const PALETTE_PAGE_SIZE = 50;
const PALETTE_MIN_QUERY_LEN = 2;
// Extra visual spacing between products in the SVG (pixels), purely cosmetic.
const VISUAL_GAP_PX = 3;
const SVG_MARGIN_PX = 20;
// Horizontal space for “Polica n” labels left of bays.
const SHELF_ROW_LABEL_GUTTER_PX = 54;

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

export function PlanogramEditorPage() {
  const navigate = useNavigate();
  const { groupOptions: taxonomyGroups, getSubgroupOptions: getTaxonomySubgroups } = useArticleTaxonomy();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [shelves, setShelves] = useState<ShelfRow[]>([]);
  const [planograms, setPlanograms] = useState<PlanogramRow[]>([]);
  const [selectedShelfId, setSelectedShelfId] = useState<string | null>(null);
  const [selectedPlanogramId, setSelectedPlanogramId] = useState<string | null>(null);
  const [loadedPlanogram, setLoadedPlanogram] = useState<LoadedPlanogram | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDimensions, setShowDimensions] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [articleFilter, setArticleFilter] = useState('');
  const [debouncedArticleFilter, setDebouncedArticleFilter] = useState('');
  const [paletteArticles, setPaletteArticles] = useState<ArticleRow[]>([]);
  const [paletteLoading, setPaletteLoading] = useState(false);
  const [paletteError, setPaletteError] = useState<string | null>(null);
  const [paletteOffset, setPaletteOffset] = useState(0);
  const [paletteHasMore, setPaletteHasMore] = useState(false);
  const paletteRequestSeq = useRef(0);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffsetMm, setDragOffsetMm] = useState(0);
  const [articleGroupFilter, setArticleGroupFilter] = useState('');
  const [articleSubgroupFilter, setArticleSubgroupFilter] = useState('');
  const [heightWarning, setHeightWarning] = useState<string | null>(null);
  const [dragSourceArticleId, setDragSourceArticleId] = useState<string | null>(null);
  const dimensionErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTimedDimensionError = (message: string) => {
    if (dimensionErrorTimeoutRef.current) {
      clearTimeout(dimensionErrorTimeoutRef.current);
    }
    setError(message);
    dimensionErrorTimeoutRef.current = setTimeout(() => {
      setError((prev) => (prev === message ? null : prev));
      dimensionErrorTimeoutRef.current = null;
    }, 10_000);
  };

  useEffect(() => {
    void loadInitial();
  }, []);

  useEffect(() => {
    return () => {
      if (dimensionErrorTimeoutRef.current) {
        clearTimeout(dimensionErrorTimeoutRef.current);
      }
    };
  }, []);

  const loadInitial = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: shelvesError } = await supabase
        .from('shelves')
        .select(
          'id,name,bay_width_mm,shelf_depth_mm,shelf_count,bay_count,bay_widths_mm,shelf_height_mm',
        )
        .order('created_at', { ascending: true });

      if (shelvesError) throw shelvesError;
      const nextShelves = (data ?? []) as ShelfRow[];
      setShelves(nextShelves);

      if (nextShelves.length > 0) {
        const firstShelfId = nextShelves[0].id;
        setSelectedShelfId(firstShelfId);
        await loadPlanogramsForShelf(firstShelfId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neuspešno učitavanje polica.');
    } finally {
      setLoading(false);
    }
  };

  const loadPlanogramsForShelf = async (shelfId: string) => {
    setError(null);

    const { data, error: queryError } = await supabase
      .from('planograms')
      .select('id,name,shelf_id,placements_jsonb')
      .eq('shelf_id', shelfId)
      .order('created_at', { ascending: true });

    if (queryError) {
      setError(queryError.message);
      return;
    }

    const rows = (data ?? []) as PlanogramRow[];
    setPlanograms(rows);

    if (rows.length > 0) {
      const first = rows[0];
      setSelectedPlanogramId(first.id);
      setLoadedPlanogram({
        row: first,
        placements: parsePlacements(first.placements_jsonb),
      });
    } else {
      setSelectedPlanogramId(null);
      setLoadedPlanogram(null);
    }
  };

  const handleShelfChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const shelfId = event.target.value || null;
    setSelectedShelfId(shelfId);
    setSelectedPlanogramId(null);
    setLoadedPlanogram(null);
    if (shelfId) {
      await loadPlanogramsForShelf(shelfId);
    }
  };

  const handlePlanogramChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const id = event.target.value || null;
    setSelectedPlanogramId(id);
    if (!id) {
      setLoadedPlanogram(null);
      return;
    }
    const row = planograms.find((p) => p.id === id);
    if (!row) {
      setLoadedPlanogram(null);
      return;
    }
    setLoadedPlanogram({
      row,
      placements: parsePlacements(row.placements_jsonb),
    });
  };

  const handleCreatePlanogram = async () => {
    setError(null);
    if (!selectedShelfId) {
      setError('Prvo kreirajte šablon police, pa ga izaberite.');
      return;
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setError('Morate biti prijavljeni da biste kreirali planogram.');
      return;
    }

    const name = window.prompt('Naziv planograma', 'Novi planogram');
    if (!name) {
      return;
    }

    const { data, error: insertError } = await supabase
      .from('planograms')
      .insert({
        user_id: user.id,
        shelf_id: selectedShelfId,
        name: name.trim(),
        placements_jsonb: [],
      })
      .select('id,name,shelf_id,placements_jsonb')
      .single();

    if (insertError) {
      setError(insertError.message);
      return;
    }

    const inserted = data as PlanogramRow;
    const next = [...planograms, inserted];
    setPlanograms(next);
    setSelectedPlanogramId(inserted.id);
    setLoadedPlanogram({
      row: inserted,
      placements: [],
    });
  };

  const currentShelf = useMemo(
    () => shelves.find((shelf) => shelf.id === selectedShelfId) ?? null,
    [shelves, selectedShelfId],
  );

  const articlesById = useMemo(() => {
    const map = new Map<string, ArticleRow>();
    for (const article of articles) {
      map.set(article.id, article);
    }
    return map;
  }, [articles]);

  const hasPaletteNarrowing = useMemo(() => {
    const q = debouncedArticleFilter.trim();
    return Boolean(
      articleGroupFilter ||
        articleSubgroupFilter ||
        q.length >= PALETTE_MIN_QUERY_LEN,
    );
  }, [articleGroupFilter, articleSubgroupFilter, debouncedArticleFilter]);

  const canQueryByName = debouncedArticleFilter.trim().length >= PALETTE_MIN_QUERY_LEN;
  const searchTooShort = articleFilter.trim().length > 0 && !canQueryByName;
  const articleGroupOptions = useMemo(() => {
    const seen = new Set<string>();
    const merged: { value: string; label: string }[] = [];
    for (const group of taxonomyGroups) {
      if (seen.has(group.value)) continue;
      seen.add(group.value);
      merged.push(group);
    }
    for (const row of articles) {
      const groupName = row.group_name?.trim();
      if (!groupName || seen.has(groupName)) continue;
      seen.add(groupName);
      merged.push({ value: groupName, label: groupName });
    }
    return merged.sort((a, b) => a.label.localeCompare(b.label, 'sr'));
  }, [taxonomyGroups, articles]);
  const articleSubgroupOptions = useMemo(() => {
    if (!articleGroupFilter) return [];
    const articleSubgroupNames = articles
      .filter((row) => row.group_name === articleGroupFilter)
      .map((row) => row.subgroup_name?.trim())
      .filter((subgroupName): subgroupName is string => Boolean(subgroupName));
    return getTaxonomySubgroups(articleGroupFilter, articleSubgroupNames);
  }, [articleGroupFilter, articles, getTaxonomySubgroups]);

  const enrichArticlesWithImageUrl = async (rows: ArticleRow[]) => {
    return Promise.all(
      rows.map(async (row) => {
        if (!row.image_path) return row;
        try {
          const { data: signed, error: signedError } = await supabase.storage
            .from(ARTICLE_BUCKET)
            .createSignedUrl(row.image_path, 60 * 60);
          if (signedError || !signed?.signedUrl) return row;
          return { ...row, imageUrl: signed.signedUrl };
        } catch {
          return row;
        }
      }),
    );
  };

  const upsertArticleCache = (nextRows: ArticleRow[]) => {
    setArticles((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]));
      for (const row of nextRows) {
        const existing = byId.get(row.id);
        byId.set(row.id, {
          ...(existing ?? {}),
          ...row,
          imageUrl: row.imageUrl ?? existing?.imageUrl,
        });
      }
      return Array.from(byId.values());
    });
  };

  const loadArticlesByIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    const uniqueIds = Array.from(new Set(ids));
    const { data, error: queryError } = await supabase
      .from('articles')
      .select(ARTICLE_SELECT)
      .in('id', uniqueIds);
    if (queryError) return;
    const signed = await enrichArticlesWithImageUrl((data ?? []) as ArticleRow[]);
    upsertArticleCache(signed);
  };

  const fetchPaletteArticles = async (append: boolean) => {
    const q = debouncedArticleFilter.trim();
    const offset = append ? paletteOffset : 0;
    if (!hasPaletteNarrowing) {
      paletteRequestSeq.current += 1;
      setPaletteArticles([]);
      setPaletteOffset(0);
      setPaletteHasMore(false);
      setPaletteError(null);
      setPaletteLoading(false);
      return;
    }

    const requestId = ++paletteRequestSeq.current;
    setPaletteLoading(true);
    setPaletteError(null);

    let query = supabase
      .from('articles')
      .select(ARTICLE_SELECT)
      .order('name', { ascending: true })
      .range(offset, offset + PALETTE_PAGE_SIZE - 1);

    if (articleGroupFilter) {
      query = query.eq('group_name', articleGroupFilter);
    }
    if (articleSubgroupFilter) {
      query = query.eq('subgroup_name', articleSubgroupFilter);
    }
    if (q.length >= PALETTE_MIN_QUERY_LEN) {
      query = query.ilike('name', `%${q}%`);
    }

    const { data, error: queryError } = await query;
    if (requestId !== paletteRequestSeq.current) return;

    if (queryError) {
      setPaletteLoading(false);
      setPaletteError(queryError.message);
      return;
    }

    const signedRows = await enrichArticlesWithImageUrl((data ?? []) as ArticleRow[]);
    if (requestId !== paletteRequestSeq.current) return;
    upsertArticleCache(signedRows);
    setPaletteArticles((prev) => {
      if (!append) return signedRows;
      const byId = new Map(prev.map((item) => [item.id, item]));
      for (const row of signedRows) {
        byId.set(row.id, row);
      }
      return Array.from(byId.values());
    });
    setPaletteOffset(offset + signedRows.length);
    setPaletteHasMore(signedRows.length === PALETTE_PAGE_SIZE);
    setPaletteLoading(false);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedArticleFilter(articleFilter);
    }, 300);
    return () => clearTimeout(timer);
  }, [articleFilter]);

  useEffect(() => {
    if (!hasPaletteNarrowing) {
      paletteRequestSeq.current += 1;
      setPaletteArticles([]);
      setPaletteOffset(0);
      setPaletteHasMore(false);
      setPaletteError(null);
      setPaletteLoading(false);
      return;
    }
    void fetchPaletteArticles(false);
  }, [articleGroupFilter, articleSubgroupFilter, debouncedArticleFilter, hasPaletteNarrowing]);

  useEffect(() => {
    if (!loadedPlanogram) return;
    const missingIds = Array.from(
      new Set(
        loadedPlanogram.placements
          .map((placement) => placement.articleId)
          .filter((id) => !articlesById.has(id)),
      ),
    );
    if (missingIds.length === 0) return;
    void loadArticlesByIds(missingIds);
  }, [loadedPlanogram, articlesById]);

  const handleLoadMorePalette = () => {
    if (!hasPaletteNarrowing || paletteLoading || !paletteHasMore) return;
    void fetchPaletteArticles(true);
  };


  const handleAddArticle = (article: ArticleRow, shelfIndex?: number, bayIndex?: number) => {
    if (!currentShelf || !loadedPlanogram) {
      setError('Prvo izaberite šablon police i planogram.');
      return;
    }

    const targetShelf = typeof shelfIndex === 'number' ? shelfIndex : 0;
    const targetBay = typeof bayIndex === 'number' ? bayIndex : 0;

    const existing = loadedPlanogram.placements
      .filter((p) => p.shelfIndex === targetShelf && p.bayIndex === targetBay)
      .map((p) => {
        const pArticle = articlesById.get(p.articleId);
        if (!pArticle) return null;
        return { start: p.xMm, end: p.xMm + pArticle.width_mm * p.facings };
      })
      .filter((r): r is { start: number; end: number } => Boolean(r))
      .sort((a, b) => a.start - b.start);

    let xMm = 0;
    const widthMm = article.width_mm;

    // Find first free slot from the left that can fit this width
    let lastEnd = 0;
    for (const range of existing) {
      const gapStart = lastEnd;
      const gapEnd = range.start - MIN_GAP_MM;
      if (gapEnd - gapStart >= widthMm) {
        xMm = gapStart;
        break;
      }
      lastEnd = Math.max(lastEnd, range.end + MIN_GAP_MM);
    }
    if (xMm === 0) {
      xMm = lastEnd;
    }

    xMm = Math.round(xMm / GRID_MM) * GRID_MM;
    const rightEdge = xMm + widthMm;
    const bayW = getBayWidthsMm(currentShelf)[targetBay] ?? currentShelf.bay_width_mm;
    const overflow = rightEdge > bayW;
    const tooTallForShelf = shelfHeightLimitMm != null && article.height_mm > shelfHeightLimitMm;

    if (overflow) {
      showTimedDimensionError(
        `Dodavanje „${article.name}" prelazi širinu rafa (${rightEdge.toFixed(
          1,
        )} mm > ${bayW} mm).`,
      );
      return;
    }
    if (tooTallForShelf) {
      showTimedDimensionError(
        `Artikal „${article.name}" je viši od visine police (${article.height_mm} mm > ${shelfHeightLimitMm} mm).`,
      );
      return;
    }

    const placement: Placement = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`,
      articleId: article.id,
      bayIndex: targetBay,
      shelfIndex: targetShelf,
      xMm,
      facings: 1,
    };

    setLoadedPlanogram((prev) =>
      prev
        ? {
            ...prev,
            placements: [...prev.placements, placement],
          }
        : prev,
    );
  };

  const handleRemovePlacement = (placementId: string) => {
    setLoadedPlanogram((prev) =>
      prev
        ? {
            ...prev,
            placements: prev.placements.filter((p) => p.id !== placementId),
          }
        : prev,
    );
  };

  const handleSavePlanogram = async () => {
    if (!loadedPlanogram) return;
    setSaving(true);
    setError(null);

    try {
      const { error: updateError } = await supabase
        .from('planograms')
        .update({
          placements_jsonb: loadedPlanogram.placements,
        })
        .eq('id', loadedPlanogram.row.id);

      if (updateError) {
        setError(updateError.message);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neuspešno čuvanje planograma.');
    } finally {
      setSaving(false);
    }
  };

  const handleClearAllPlacements = () => {
    if (!loadedPlanogram) return;
    if (loadedPlanogram.placements.length === 0) return;
    const shouldClear = window.confirm('Da li želite da obrišete sve artikle sa 2D police?');
    if (!shouldClear) return;
    setLoadedPlanogram((prev) => (prev ? { ...prev, placements: [] } : prev));
    setError(null);
  };

  const handleAutoArrange = () => {
    if (!loadedPlanogram || !currentShelf) return;
    if (loadedPlanogram.placements.length === 0) return;

    const bayWidths = getBayWidthsMm(currentShelf);

    setLoadedPlanogram((prev) => {
      if (!prev) return prev;

      // Group placements per bay + shelf row.
      const groups = new Map<string, Placement[]>();
      for (const placement of prev.placements) {
        const key = `${placement.bayIndex}-${placement.shelfIndex}`;
        const arr = groups.get(key);
        if (arr) {
          arr.push(placement);
        } else {
          groups.set(key, [placement]);
        }
      }

      const repositioned = new Map<string, number>();

      for (const arr of groups.values()) {
        const items = arr
          .map((placement) => {
            const article = articlesById.get(placement.articleId);
            const width = article ? article.width_mm * placement.facings : 0;
            return { placement, width };
          })
          .sort((a, b) => a.placement.xMm - b.placement.xMm);

        const bayW = bayWidths[items[0]?.placement.bayIndex ?? 0] ?? currentShelf.bay_width_mm;
        const totalWidth = items.reduce((sum, item) => sum + item.width, 0);
        const leftover = bayW - totalWidth;

        if (leftover >= 0 && items.length > 0) {
          // Distribute the free space evenly between and around the items.
          const gap = leftover / (items.length + 1);
          let cursor = gap;
          for (const item of items) {
            repositioned.set(item.placement.id, Math.max(0, Math.round(cursor)));
            cursor += item.width + gap;
          }
        } else {
          // Not enough room: pack tightly from the left.
          let cursor = 0;
          for (const item of items) {
            repositioned.set(item.placement.id, Math.round(cursor));
            cursor += item.width + MIN_GAP_MM;
          }
        }
      }

      return {
        ...prev,
        placements: prev.placements.map((placement) =>
          repositioned.has(placement.id)
            ? { ...placement, xMm: repositioned.get(placement.id) as number }
            : placement,
        ),
      };
    });
    setError(null);
  };

  const bayWidthsMm = useMemo(() => {
    if (!currentShelf) return [1000];
    return getBayWidthsMm(currentShelf);
  }, [currentShelf]);

  const bayStartsMm = useMemo(() => bayStartOffsetsMm(bayWidthsMm), [bayWidthsMm]);

  const bayLayoutRef = useRef<{ widths: number[]; starts: number[] }>({
    widths: [1000],
    starts: [0],
  });
  bayLayoutRef.current = { widths: bayWidthsMm, starts: bayStartsMm };

  const bayCount = bayWidthsMm.length;
  const shelfWidthMm = totalShelfWidthMm(bayWidthsMm);
  const pxPerMm = BASE_PX_PER_MM * zoomLevel;

  const bayEdgesPx = useMemo(
    () => bayEdgePositionsMm(bayWidthsMm).map((mm) => mm * pxPerMm),
    [bayWidthsMm, pxPerMm],
  );

  const shelfDepthMm = currentShelf?.shelf_depth_mm ?? 400;
  const shelfCount = currentShelf?.shelf_count ?? 1;
  const shelfHeightLimitMm = currentShelf?.shelf_height_mm ?? null;

  const shelfWidthPx = shelfWidthMm * pxPerMm;
  const shelfHeightPx = 12;
  const shelfSpacingPx = 80;
  const bayHeightPx = 60 + shelfCount * shelfSpacingPx;
  const svgWidthPx = shelfWidthPx + 2 * SVG_MARGIN_PX + SHELF_ROW_LABEL_GUTTER_PX;
  const svgHeightPx = bayHeightPx + 2 * SVG_MARGIN_PX;

  const getSvgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    return point.matrixTransform(matrix.inverse());
  };

  const getShelfContentX = (clientX: number, clientY: number) => {
    const svgPoint = getSvgPoint(clientX, clientY);
    if (!svgPoint) return 0;
    return svgPoint.x - SVG_MARGIN_PX - SHELF_ROW_LABEL_GUTTER_PX;
  };

  const getShelfContentY = (clientX: number, clientY: number) => {
    const svgPoint = getSvgPoint(clientX, clientY);
    if (!svgPoint) return 0;
    return svgPoint.y - SVG_MARGIN_PX;
  };

  useEffect(() => {
    if (!loadedPlanogram || !currentShelf || shelfHeightLimitMm == null) {
      setHeightWarning(null);
      return;
    }

    const tooTallNames = new Set<string>();
    for (const placement of loadedPlanogram.placements) {
      const article = articlesById.get(placement.articleId);
      if (!article) continue;
      if (article.height_mm > shelfHeightLimitMm) {
        tooTallNames.add(article.name);
      }
    }

    if (tooTallNames.size === 0) {
      setHeightWarning(null);
    } else {
      const names = Array.from(tooTallNames);
      if (names.length === 1) {
        setHeightWarning(
          `Artikal „${names[0]}" je viši od saglasne visine police (${shelfHeightLimitMm} mm).`,
        );
      } else {
        setHeightWarning(
          `Neki artikli su viši od saglasne visine police (${shelfHeightLimitMm} mm): ${names.join(
            ', ',
          )}.`,
        );
      }
    }
  }, [loadedPlanogram, currentShelf, shelfHeightLimitMm, articlesById]);

  useEffect(() => {
    if (!heightWarning) return;
    const timer = setTimeout(() => setHeightWarning(null), 10_000);
    return () => clearTimeout(timer);
  }, [heightWarning]);

  const bayShelfSummaries = useMemo(() => {
    if (!loadedPlanogram || !currentShelf) return [];

    const shelfDepthMmValue = currentShelf.shelf_depth_mm ?? 0;

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

    for (const placement of loadedPlanogram.placements) {
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
  }, [loadedPlanogram, currentShelf, articlesById]);

  const handlePrint = () => {
    if (!loadedPlanogram) return;
    navigate(`/print?planogramId=${loadedPlanogram.row.id}`);
  };

  const getPointerMm = (clientX: number, clientY: number) => {
    const localX = getShelfContentX(clientX, clientY);
    const clampedPx = Math.max(0, Math.min(localX, shelfWidthPx));
    return clampedPx / pxPerMm;
  };

  const handlePlacementMouseDown = (event: MouseEvent<SVGGElement>, placement: Placement) => {
    event.preventDefault();
    const { starts } = bayLayoutRef.current;
    const bayStart = starts[placement.bayIndex] ?? 0;
    const pointerMm = getPointerMm(event.clientX, event.clientY);
    const localPointer = pointerMm - bayStart;
    setDraggingId(placement.id);
    setDragOffsetMm(placement.xMm - localPointer);
  };

  const handleSvgMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    if (!draggingId || !loadedPlanogram || !currentShelf) return;
    const pointerMm = getPointerMm(event.clientX, event.clientY);
    setLoadedPlanogram((prev) => {
      if (!prev) return prev;
      const placements = prev.placements;
      const movingIndex = placements.findIndex((p) => p.id === draggingId);
      if (movingIndex === -1) return prev;

      const moving = placements[movingIndex];
      const article = articlesById.get(moving.articleId);
      if (!article) return prev;

      const { widths, starts } = bayLayoutRef.current;
      const bayWidth = widths[moving.bayIndex] ?? currentShelf.bay_width_mm;
      const bayStart = starts[moving.bayIndex] ?? 0;
      const widthMm = article.width_mm * moving.facings;

      const peers = placements
        .map((p, index) => ({ p, index }))
        .filter(
          ({ p }) =>
            p.id !== draggingId &&
            p.shelfIndex === moving.shelfIndex &&
            p.bayIndex === moving.bayIndex,
        )
        .map(({ p, index }) => {
          const a = articlesById.get(p.articleId);
          if (!a) return null;
          return {
            index,
            start: p.xMm,
            end: p.xMm + a.width_mm * p.facings,
          };
        })
        .filter(
          (
            r,
          ): r is {
            index: number;
            start: number;
            end: number;
          } => Boolean(r),
        )
        .sort((a, b) => a.start - b.start);

      let rawMm = pointerMm + dragOffsetMm - bayStart;
      rawMm = Math.round(rawMm / GRID_MM) * GRID_MM;
      rawMm = Math.max(0, Math.min(rawMm, bayWidth - widthMm));

      let minAllowed = 0;
      let maxAllowed = bayWidth - widthMm;

      const leftPeer = [...peers]
        .filter((peer) => peer.end <= moving.xMm + 1e-3)
        .sort((a, b) => b.end - a.end)[0];
      if (leftPeer) {
        minAllowed = Math.max(minAllowed, leftPeer.end + MIN_GAP_MM);
      }

      const rightPeer = peers.find((peer) => peer.start >= moving.xMm + widthMm - 1e-3);
      if (rightPeer) {
        maxAllowed = Math.min(maxAllowed, rightPeer.start - widthMm - MIN_GAP_MM);
      }

      const xMm = Math.max(minAllowed, Math.min(rawMm, maxAllowed));

      const nextPlacements = placements.slice();
      nextPlacements[movingIndex] = { ...moving, xMm };
      return { ...prev, placements: nextPlacements };
    });
  };

  const handleSvgMouseUp = () => {
    setDraggingId(null);
    setDragOffsetMm(0);
  };

  const handlePaletteDragStart = (event: DragEvent<HTMLButtonElement>, articleId: string) => {
    setDragSourceArticleId(articleId);
    event.dataTransfer.effectAllowed = 'copy';
  };

  const handleSvgDragOver = (event: DragEvent<SVGSVGElement>) => {
    if (!dragSourceArticleId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleSvgDrop = (event: DragEvent<SVGSVGElement>) => {
    if (!dragSourceArticleId || !currentShelf || !loadedPlanogram) return;
    event.preventDefault();

    const article = articlesById.get(dragSourceArticleId);
    if (!article) {
      setDragSourceArticleId(null);
      return;
    }

    const svg = svgRef.current;
    if (!svg) {
      setDragSourceArticleId(null);
      return;
    }

    const localX = getShelfContentX(event.clientX, event.clientY);
    const localY = getShelfContentY(event.clientX, event.clientY);

    const clampedPxX = Math.max(0, Math.min(localX, shelfWidthPx));
    const shelfIndexFromY = Math.floor(
      (bayHeightPx - shelfHeightPx - localY) / shelfSpacingPx + 0.5,
    );
    const targetShelf =
      Math.max(0, Math.min(shelfCount - 1, shelfIndexFromY)) || 0;

    const widths = bayLayoutRef.current.widths;
    const starts = bayLayoutRef.current.starts;
    const absMm = clampedPxX / pxPerMm;
    let targetBay = bayIndexAtAbsoluteMm(absMm, widths);
    targetBay = Math.max(0, Math.min(bayCount - 1, targetBay));
    const bayW = widths[targetBay];
    const bayStart = starts[targetBay];

    let xMm = absMm - bayStart;
    xMm = Math.round(xMm / GRID_MM) * GRID_MM;

    const existing = loadedPlanogram.placements.filter(
      (p) => p.shelfIndex === targetShelf && p.bayIndex === targetBay,
    );

    let maxEnd = 0;
    for (const placement of existing) {
      const pArticle = articlesById.get(placement.articleId);
      if (!pArticle) continue;
      const end = placement.xMm + pArticle.width_mm * placement.facings;
      if (end > maxEnd) maxEnd = end;
    }

    const minX = Math.max(0, Math.min(xMm, bayW - article.width_mm));
    const candidateStart = Math.max(minX, maxEnd + MIN_GAP_MM);

    const rightEdge = candidateStart + article.width_mm;
    if (rightEdge > bayW) {
      showTimedDimensionError(
        `Otpuštanje „${article.name}" prelazi širinu rafa (${rightEdge.toFixed(
          1,
        )} mm > ${bayW} mm).`,
      );
      setDragSourceArticleId(null);
      return;
    }
    if (shelfHeightLimitMm != null && article.height_mm > shelfHeightLimitMm) {
      showTimedDimensionError(
        `Artikal „${article.name}" je viši od visine police (${article.height_mm} mm > ${shelfHeightLimitMm} mm).`,
      );
      setDragSourceArticleId(null);
      return;
    }

    const placement: Placement = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`,
      articleId: article.id,
      bayIndex: targetBay,
      shelfIndex: targetShelf,
      xMm: candidateStart,
      facings: 1,
    };

    setLoadedPlanogram((prev) =>
      prev
        ? {
            ...prev,
            placements: [...prev.placements, placement],
          }
        : prev,
    );
    setDragSourceArticleId(null);
  };

  return (
    <div className="stack-v">
      <div className="panel stack-v">
        <div className="panel-header">
          <div className="stack-v">
            <div className="panel-title">Uređivač planograma</div>
            <div className="panel-subtitle">
              Izaberite šablon police, kreirajte planogram, zatim postavite artikle na bilo koju policu.
            </div>
          </div>
          <div className="stack-h">
            <span className="badge">Podaci Supabase</span>
          </div>
        </div>

        <div className="form-grid">
          <label className="form-row">
            <span className="muted">Šablon police</span>
            <select className="input" value={selectedShelfId ?? ''} onChange={handleShelfChange}>
              {shelves.length === 0 && <option value="">Još nema polica</option>}
              {shelves.map((shelf) => {
                const widths = getBayWidthsMm(shelf);
                const totalMm = totalShelfWidthMm(widths);
                const label =
                  widths.length > 1
                    ? `${shelf.name} · ukupno ${totalMm}×${shelf.shelf_depth_mm} mm · rafovi ${widths.join('/')} mm · ${shelf.shelf_count} pol.`
                    : `${shelf.name} · ${shelf.bay_width_mm}×${shelf.shelf_depth_mm} mm · ${shelf.shelf_count} pol.`;
                return (
                  <option key={shelf.id} value={shelf.id}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="form-row">
            <span className="muted">Broj polica</span>
            <span className="metric">
              Ukupno polica: <strong>{shelfCount}</strong>
            </span>
          </label>
          <label className="form-row">
            <span className="muted">Broj rafova</span>
            <span className="metric">
              Ukupno rafova: <strong>{bayCount}</strong>
            </span>
          </label>
          <label className="form-row">
            <span className="muted">Planogram</span>
            <select className="input" value={selectedPlanogramId ?? ''} onChange={handlePlanogramChange}>
              <option value="">Izaberite ili kreirajte</option>
              {planograms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="stack-h-between">
          <div className="metric-row">
            {bayCount > 1 ? (
              <>
                <div className="metric">
                  Ukupna širina: <strong>{shelfWidthMm}</strong> mm
                </div>
                {bayWidthsMm.map((bayWidth, index) => (
                  <div className="metric" key={`bay-width-metric-${index}`}>
                    Raf {index + 1}: <strong>{bayWidth}</strong> mm
                  </div>
                ))}
              </>
            ) : (
              <div className="metric">
                Širina: <strong>{shelfWidthMm}</strong> mm
              </div>
            )}
            <div className="metric">
              Dubina: <strong>{shelfDepthMm}</strong> mm
            </div>
            {shelfHeightLimitMm != null && (
              <div className="metric">
                Visina police: <strong>{shelfHeightLimitMm}</strong> mm
              </div>
            )}
            <div className="metric">
              Skala na ekranu: <strong>{pxPerMm.toFixed(2)}</strong> px/mm
            </div>
          </div>
          <div className="stack-h">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowDimensions((prev) => !prev)}
              disabled={!loadedPlanogram}
            >
              {showDimensions ? 'Sakrij dimenzije' : 'Prikaži dimenzije'}
            </button>
            <button type="button" className="btn-ghost" onClick={handleCreatePlanogram}>
              Nov planogram
            </button>
            <button
              type="button"
              className="btn-danger-ghost"
              disabled={!loadedPlanogram || loadedPlanogram.placements.length === 0}
              onClick={handleClearAllPlacements}
            >
              Obriši sve iz 2D police
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={!loadedPlanogram || loadedPlanogram.placements.length === 0}
              onClick={handleAutoArrange}
            >
              Poravnaj artikle
            </button>
            <button type="button" className="btn" disabled={!loadedPlanogram || saving} onClick={handleSavePlanogram}>
              {saving ? 'Čuvanje…' : 'Sačuvaj raspored'}
            </button>
            <button type="button" className="btn-ghost" disabled={!loadedPlanogram} onClick={handlePrint}>
              Štampa A4
            </button>
          </div>
        </div>

        {error && <div className="error-text">{error}</div>}
        {heightWarning && <div className="error-text">{heightWarning}</div>}
      </div>

      <div className="planogram-layout">
        <div className="planogram-left">
          <div className="panel stack-v">
        <div className="stack-h-between">
          <div className="stack-v">
            <div className="panel-title">Paleta artikala</div>
            <div className="panel-subtitle">
              Prevucite karticu artikla na policu ili koristite dugme + na postavljenom artiklu da dodate još lica istog proizvoda.
            </div>
          </div>
        </div>

        <>
          <div className="form-grid" style={{ marginBottom: '0.5rem' }}>
            <label className="form-row">
              <span className="muted">Grupa</span>
              <select
                className="input"
                value={articleGroupFilter}
                onChange={(event) => {
                  setArticleGroupFilter(event.target.value);
                  setArticleSubgroupFilter('');
                }}
              >
                <option value="">Sve grupe</option>
                {articleGroupOptions.map((group) => (
                  <option key={group.value} value={group.value}>
                    {group.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-row">
              <span className="muted">Podgrupa</span>
              <select
                className="input"
                value={articleSubgroupFilter}
                onChange={(event) => setArticleSubgroupFilter(event.target.value)}
                disabled={!articleGroupFilter}
              >
                <option value="">Sve podgrupe</option>
                {articleGroupFilter &&
                  articleSubgroupOptions.map((subgroup) => (
                    <option key={subgroup.value} value={subgroup.value}>
                      {subgroup.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="form-row">
              <span className="muted">Filter po nazivu</span>
              <input
                className="input"
                type="text"
                placeholder={`Kucajte bar ${PALETTE_MIN_QUERY_LEN} slova…`}
                value={articleFilter}
                onChange={(event) => setArticleFilter(event.target.value)}
              />
            </label>
          </div>

          {!hasPaletteNarrowing && (
            <p className="muted">
              Izaberite grupu/podgrupu ili unesite bar {PALETTE_MIN_QUERY_LEN} slova da biste učitali artikle.
            </p>
          )}
          {searchTooShort && !articleGroupFilter && !articleSubgroupFilter && (
            <p className="muted">Za pretragu po nazivu unesite bar {PALETTE_MIN_QUERY_LEN} slova.</p>
          )}
          {paletteError && <p className="error-text">{paletteError}</p>}
          {hasPaletteNarrowing && (
            <>
              {paletteLoading && paletteArticles.length === 0 && <p className="muted">Učitavanje artikala…</p>}
              {!paletteLoading && paletteArticles.length === 0 && !paletteError && (
                <p className="muted">Nema artikala za izabrane filtere.</p>
              )}
              {paletteArticles.length > 0 && (
                <>
                  <div
                    className="article-search-results"
                    style={{ maxHeight: 460, overflowY: 'auto', paddingRight: '0.35rem' }}
                  >
                    {paletteArticles.map((article) => (
                      <button
                        key={article.id}
                        type="button"
                        className="article-card"
                        draggable
                        onDragStart={(event) => handlePaletteDragStart(event, article.id)}
                      >
                        <div className="article-card-thumb">
                          {article.imageUrl ? (
                            <img src={article.imageUrl} alt={article.name} />
                          ) : (
                            <div className="article-card-thumb-placeholder">Bez slike</div>
                          )}
                        </div>
                        <div className="article-card-body">
                          <div className="article-card-name">{article.name}</div>
                          <div className="article-card-meta">
                            <span>{formatArticleDimensionsCompact(article)}</span>
                          </div>
                          {(article.group_name || article.subgroup_name) && (
                            <div className="article-card-tags">
                              {article.group_name && <span className="tag">{article.group_name}</span>}
                              {article.subgroup_name && <span className="tag">{article.subgroup_name}</span>}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                  {paletteHasMore && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={handleLoadMorePalette}
                        disabled={paletteLoading}
                      >
                        {paletteLoading ? 'Učitavanje…' : `Učitaj još ${PALETTE_PAGE_SIZE}`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
          </div>
        </div>

        <div className="planogram-right">
          <div className="panel stack-v">
        <div className="stack-h-between">
          <div className="stack-v">
            <div className="panel-title">Raf police</div>
            <div className="panel-subtitle">
              Prikazani su svi redovi za izabrani šablon. Prevucite artikl sa palete na željenu policu ili dodajte pomoću dugmeta +.
            </div>
          </div>
          <div className="planogram-zoom-controls stack-h">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setZoomLevel((prev) => Math.max(ZOOM_MIN, prev - ZOOM_STEP))}
              disabled={zoomLevel <= ZOOM_MIN}
              aria-label="Umanji prikaz"
            >
              −
            </button>
            <label className="planogram-zoom-slider">
              <span className="muted">Zoom</span>
              <input
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={ZOOM_STEP}
                value={zoomLevel}
                onChange={(event) => setZoomLevel(Number(event.target.value))}
              />
              <span className="metric">{Math.round(zoomLevel * 100)}%</span>
            </label>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setZoomLevel((prev) => Math.min(ZOOM_MAX, prev + ZOOM_STEP))}
              disabled={zoomLevel >= ZOOM_MAX}
              aria-label="Uvećaj prikaz"
            >
              +
            </button>
            <button type="button" className="btn-ghost" onClick={() => setZoomLevel(1)}>
              Reset
            </button>
          </div>
        </div>

        <div className="svg-canvas-wrap">
        <svg
          ref={svgRef}
          className="svg-canvas"
          width={svgWidthPx}
          height={svgHeightPx}
          viewBox={`0 0 ${svgWidthPx} ${svgHeightPx}`}
          onMouseMove={handleSvgMouseMove}
          onMouseUp={handleSvgMouseUp}
          onMouseLeave={handleSvgMouseUp}
          onDragOver={handleSvgDragOver}
          onDrop={handleSvgDrop}
        >
          <defs>
              <linearGradient id="shelfGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#e2e8f0" />
                <stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>
            <linearGradient id="productGradient" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>

          <g transform={`translate(${SVG_MARGIN_PX} ${SVG_MARGIN_PX})`}>
            {Array.from({ length: shelfCount }, (_, i) => {
              const y = bayHeightPx - shelfHeightPx - i * shelfSpacingPx;
              const cy = y + shelfHeightPx / 2;
              return (
                <text
                  key={`shelf-row-label-${i}`}
                  x={SHELF_ROW_LABEL_GUTTER_PX - 6}
                  y={cy}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill="#475569"
                >
                  Polica {i + 1}
                </text>
              );
            })}
            <g transform={`translate(${SHELF_ROW_LABEL_GUTTER_PX} 0)`}>
            {/* Vertical bay bars including outer edges */}
            {bayEdgesPx.map((x, index) => {
              const topOverhangPx = 20;
              const bottomOverhangPx = 8;
              const topY =
                bayHeightPx - shelfHeightPx - (shelfCount - 1) * shelfSpacingPx - topOverhangPx;
              const height =
                shelfHeightPx + (shelfCount - 1) * shelfSpacingPx + topOverhangPx + bottomOverhangPx;
              return (
                <rect
                  key={`bay-bar-${index}-${x}`}
                  x={x - 4}
                  y={topY}
                  width={8}
                  height={height}
                  fill="#64748b"
                  stroke="#334155"
                  strokeWidth={1.25}
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
                    fill="url(#shelfGradient)"
                    stroke="#64748b"
                    strokeWidth={1}
                    rx={6}
                  />
                  <line
                    x1={0}
                    y1={y}
                    x2={shelfWidthPx}
                    y2={y}
                    stroke="#cbd5e1"
                    strokeWidth={1}
                    strokeDasharray="4 2"
                  />
                </g>
              );
            })}

            {loadedPlanogram &&
              loadedPlanogram.placements.map((placement) => {
                const article = articlesById.get(placement.articleId);
                if (!article) return null;

                const shelfIndex = placement.shelfIndex ?? 0;
                const baseY = bayHeightPx - shelfHeightPx - shelfIndex * shelfSpacingPx;

                const widthMm = article.width_mm * placement.facings;
                const heightMm = article.height_mm;
                const bayStartMm = bayStartsMm[placement.bayIndex ?? 0] ?? 0;
                const bayLimitMm = bayWidthsMm[placement.bayIndex ?? 0] ?? 1000;
                const rawX = (placement.xMm + bayStartMm) * pxPerMm;
                const rawWidth = widthMm * pxPerMm;
                // Apply a small pixel-only shrink so products don't look glued together visually.
                const visualGap = VISUAL_GAP_PX;
                const widthPx = Math.max(1, rawWidth - visualGap);
                const xPx = rawX + visualGap / 2;
                const heightPx = heightMm * pxPerMm;
                const yPx = baseY - heightPx;

                const rightEdge = placement.xMm + widthMm;
                const overflow = rightEdge > bayLimitMm;
                const tooTall = shelfHeightLimitMm != null && heightMm > shelfHeightLimitMm;
                if (tooTall) return null;

                return (
                  <g
                    key={placement.id}
                    onMouseDown={(event) => handlePlacementMouseDown(event, placement)}
                    style={{ cursor: 'grab' }}
                  >
                    {!article.imageUrl && (
                      <rect
                        x={xPx}
                        y={yPx}
                        width={widthPx}
                        height={heightPx}
                        rx={4}
                        fill="url(#productGradient)"
                        stroke={overflow || tooTall ? '#ef4444' : '#4f46e5'}
                        strokeWidth={overflow || tooTall ? 2 : 1}
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
                    {showDimensions && (
                      <text x={xPx + 4} y={yPx + 12} fontSize={8} fill="#ffffff">
                        {formatArticleDimensionsCompact(article)}
                      </text>
                    )}
                    <rect
                      x={xPx}
                      y={yPx - 16}
                      width={18}
                      height={14}
                      rx={3}
                      fill="#10b981"
                      stroke="#047857"
                      strokeWidth={1}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleAddArticle(article, shelfIndex, placement.bayIndex);
                      }}
                    />
                    <text
                      x={xPx + 9}
                      y={yPx - 6}
                      fontSize={11}
                      textAnchor="middle"
                      fill="#ffffff"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleAddArticle(article, shelfIndex, placement.bayIndex);
                      }}
                    >
                      +
                    </text>
                    <rect
                      x={xPx + widthPx - 16}
                      y={yPx - 10}
                      width={14}
                      height={14}
                      rx={3}
                      fill="#ffffff"
                      stroke="#94a3b8"
                      strokeWidth={1}
                      onClick={() => handleRemovePlacement(placement.id)}
                    />
                    <text
                      x={xPx + widthPx - 9}
                      y={yPx + 0}
                      fontSize={10}
                      textAnchor="middle"
                      fill="#4f46e5"
                      onClick={() => handleRemovePlacement(placement.id)}
                    >
                      ×
                    </text>
                  </g>
                );
              })}

            <text x={4} y={10} fontSize={9} fill="#475569">
              0 mm
            </text>
            {bayCount > 1 ? (
              <>
                {bayWidthsMm.map((bayWidth, index) => {
                  const centerPx = (bayStartsMm[index] + bayWidth / 2) * pxPerMm;
                  return (
                    <text
                      key={`bay-width-label-${index}`}
                      x={centerPx}
                      y={10}
                      fontSize={9}
                      fontWeight={600}
                      textAnchor="middle"
                      fill="#1e293b"
                    >
                      Raf {index + 1}: {bayWidth} mm
                    </text>
                  );
                })}
                <text
                  x={shelfWidthPx / 2}
                  y={24}
                  fontSize={9}
                  textAnchor="middle"
                  fill="#475569"
                >
                  Ukupno {shelfWidthMm} mm
                </text>
              </>
            ) : (
              <text x={shelfWidthPx / 2} y={10} fontSize={9} fontWeight={600} textAnchor="middle" fill="#1e293b">
                Širina {shelfWidthMm} mm
              </text>
            )}
            </g>
          </g>
        </svg>
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
                      <strong>{item.name}</strong> –{' '}
                      {item.facingsTotal === 1 ? '1 lice' : `${item.facingsTotal} lica`}
                      {item.depthMm
                        ? item.totalUnits && item.rowsDeep && item.rowsDeep > 0
                          ? `, otprilike ${item.totalUnits} kom. (${item.rowsDeep} red${item.rowsDeep !== 1 ? 'a' : ''} dubinski prema dubini police)`
                          : `, dubina ${item.depthMm} mm (dubina police ${currentShelf?.shelf_depth_mm ?? 0} mm)`
                        : ` (dubina nije uneta — samo položaji u širini)`}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
          </div>
        </div>
      </div>
    </div>
  );
}

