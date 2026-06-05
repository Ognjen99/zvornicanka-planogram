import type { FormEvent, ChangeEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatArticleDimensions } from '../../lib/formatArticleDimensions';
import { removeImageBackground } from '../../lib/removeImageBackground';
import { useArticleTaxonomy } from './useArticleTaxonomy';

type ArticleRow = {
  id: string;
  user_id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  depth_mm: number | null;
  image_path: string | null;
  group_name: string | null;
  subgroup_name: string | null;
};

type ArticleWithUrl = ArticleRow & {
  imageUrl?: string;
};

const ARTICLE_BUCKET = 'article-images';
const ARTICLE_LIST_PAGE_SIZE = 25;

async function enrichArticlesWithImageUrl(rows: ArticleRow[]) {
  return Promise.all(
    rows.map(async (row) => {
      if (!row.image_path) {
        return row;
      }

      try {
        const { data: signed, error: signedError } = await supabase.storage
          .from(ARTICLE_BUCKET)
          .createSignedUrl(row.image_path, 60 * 60);

        if (signedError || !signed?.signedUrl) {
          return row;
        }

        return { ...row, imageUrl: signed.signedUrl };
      } catch {
        return row;
      }
    }),
  );
}

export function ArticlesPage() {
  const {
    groupOptions: taxonomyGroups,
    getSubgroupOptions: getTaxonomySubgroups,
    loading: taxonomyLoading,
    deleteTaxonomyGroup,
    deleteTaxonomySubgroup,
    isTaxonomyGroup,
    isTaxonomySubgroup,
  } = useArticleTaxonomy();

  const [listArticles, setListArticles] = useState<ArticleWithUrl[]>([]);
  const [listTotalCount, setListTotalCount] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listLoadingMore, setListLoadingMore] = useState(false);
  const [listHasMore, setListHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [widthMm, setWidthMm] = useState('');
  const [heightMm, setHeightMm] = useState('');
  const [depthMm, setDepthMm] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [removeWhiteBg, setRemoveWhiteBg] = useState(true);
  const [saving, setSaving] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [subgroupName, setSubgroupName] = useState('');
  const [listGroupFilter, setListGroupFilter] = useState('');
  const [listSubgroupFilter, setListSubgroupFilter] = useState('');
  const [listNameFilter, setListNameFilter] = useState('');
  const [debouncedListNameFilter, setDebouncedListNameFilter] = useState('');
  const [customGroups, setCustomGroups] = useState<string[]>([]);
  const [customSubgroups, setCustomSubgroups] = useState<Record<string, string[]>>({});
  const [manageGroupName, setManageGroupName] = useState('');
  const [manageSubgroupName, setManageSubgroupName] = useState('');
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [deletingSubgroup, setDeletingSubgroup] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedListNameFilter(listNameFilter);
    }, 300);
    return () => clearTimeout(timer);
  }, [listNameFilter]);

  const groupOptions = useMemo(() => {
    const seen = new Set<string>();
    const merged: { value: string; label: string }[] = [];
    for (const group of taxonomyGroups) {
      if (seen.has(group.value)) continue;
      seen.add(group.value);
      merged.push(group);
    }
    for (const customGroup of customGroups) {
      const trimmed = customGroup.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      merged.push({ value: trimmed, label: trimmed });
    }
    return merged.sort((a, b) => a.label.localeCompare(b.label, 'sr'));
  }, [taxonomyGroups, customGroups]);

  const getSubgroupOptions = useCallback(
    (group: string) => {
      if (!group) return [];
      return getTaxonomySubgroups(group, customSubgroups[group] ?? []);
    },
    [customSubgroups, getTaxonomySubgroups],
  );

  const manageSubgroupOptions = useMemo(
    () => (manageGroupName ? getSubgroupOptions(manageGroupName) : []),
    [manageGroupName, getSubgroupOptions],
  );

  const loadArticleList = useCallback(
    async (reset: boolean, currentLength = 0) => {
      if (reset) {
        setListLoading(true);
      } else {
        setListLoadingMore(true);
      }
      setError(null);

      const offset = reset ? 0 : currentLength;

      let query = supabase
        .from('articles')
        .select('id,user_id,name,width_mm,height_mm,depth_mm,image_path,group_name,subgroup_name', {
          count: 'exact',
        })
        .order('created_at', { ascending: false });

      if (listGroupFilter) {
        query = query.eq('group_name', listGroupFilter);
      }
      if (listSubgroupFilter) {
        query = query.eq('subgroup_name', listSubgroupFilter);
      }
      const nameQuery = debouncedListNameFilter.trim();
      if (nameQuery) {
        query = query.ilike('name', `%${nameQuery}%`);
      }

      const { data, error: queryError, count } = await query.range(
        offset,
        offset + ARTICLE_LIST_PAGE_SIZE - 1,
      );

      if (queryError) {
        setError(queryError.message);
        setListLoading(false);
        setListLoadingMore(false);
        return;
      }

      const rows = (data ?? []) as ArticleRow[];
      const withUrls = await enrichArticlesWithImageUrl(rows);
      const total = count ?? 0;

      setListTotalCount(total);
      setListArticles((prev) => {
        if (reset) return withUrls;
        const byId = new Map(prev.map((item) => [item.id, item]));
        for (const row of withUrls) {
          byId.set(row.id, row);
        }
        return Array.from(byId.values());
      });
      setListHasMore(offset + withUrls.length < total);
      setListLoading(false);
      setListLoadingMore(false);
    },
    [debouncedListNameFilter, listGroupFilter, listSubgroupFilter],
  );

  useEffect(() => {
    void loadArticleList(true);
  }, [loadArticleList]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
  };

  const resetForm = () => {
    setName('');
    setWidthMm('');
    setHeightMm('');
    setDepthMm('');
    setFile(null);
    setGroupName('');
    setSubgroupName('');
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const width = Number(widthMm);
      const height = Number(heightMm);
      const depth = depthMm ? Number(depthMm) : null;

      if (!name.trim()) {
        setError('Naziv je obavezan.');
        return;
      }
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        setError('Širina i visina moraju biti pozitivni brojevi (mm).');
        return;
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setError('Morate biti prijavljeni da biste kreirali artikle.');
        return;
      }

      let imagePath: string | null = null;

      if (file) {
        let uploadBody: Blob = file;
        let ext = file.name.includes('.') ? file.name.split('.').pop() ?? 'png' : 'png';
        let contentType = file.type || `image/${ext}`;

        if (removeWhiteBg) {
          try {
            uploadBody = await removeImageBackground(file);
            // Background removal always outputs a transparent PNG.
            ext = 'png';
            contentType = 'image/png';
          } catch {
            uploadBody = file;
          }
        }

        const base = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
        const baseName = file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '-').toLowerCase() || 'slika';
        const safeName = `${baseName}.${ext}`;
        imagePath = `${user.id}/${base}-${safeName}`;

        const { error: uploadError } = await supabase.storage.from(ARTICLE_BUCKET).upload(imagePath, uploadBody, {
          upsert: true,
          contentType,
        });

        if (uploadError) {
          setError(`Otpremanje slike nije uspelo: ${uploadError.message}`);
          return;
        }
      }

      const { error: insertError } = await supabase.from('articles').insert({
        user_id: user.id,
        name: name.trim(),
        width_mm: width,
        height_mm: height,
        depth_mm: depth,
        image_path: imagePath,
        group_name: groupName || null,
        subgroup_name: subgroupName || null,
      });

      if (insertError) {
        setError(insertError.message);
        return;
      }

      resetForm();
      await loadArticleList(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neočekivana greška pri kreiranju artikla.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteArticle = async (article: ArticleRow) => {
    setError(null);

    try {
      const { error: deleteError } = await supabase.from('articles').delete().eq('id', article.id);
      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      setListArticles((prev) => prev.filter((item) => item.id !== article.id));
      setListTotalCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neočekivana greška pri brisanju artikla.');
    }
  };

  const handleAddGroup = () => {
    const raw = window.prompt('Unesite naziv nove grupe');
    const nextName = raw?.trim();
    if (!nextName) return;
    setCustomGroups((prev) => (prev.includes(nextName) ? prev : [...prev, nextName]));
    setGroupName(nextName);
    setSubgroupName('');
    setError(null);
  };

  const handleAddSubgroup = () => {
    if (!groupName) {
      setError('Prvo izaberite grupu, pa onda dodajte podgrupu.');
      return;
    }
    const raw = window.prompt(`Unesite naziv nove podgrupe za grupu "${groupName}"`);
    const nextName = raw?.trim();
    if (!nextName) return;
    setCustomSubgroups((prev) => {
      const existing = prev[groupName] ?? [];
      if (existing.includes(nextName)) return prev;
      return { ...prev, [groupName]: [...existing, nextName] };
    });
    setSubgroupName(nextName);
    setError(null);
  };

  const clearGroupSelections = (deletedGroupName: string) => {
    if (groupName === deletedGroupName) {
      setGroupName('');
      setSubgroupName('');
    }
    if (manageGroupName === deletedGroupName) {
      setManageGroupName('');
      setManageSubgroupName('');
    }
    if (listGroupFilter === deletedGroupName) {
      setListGroupFilter('');
      setListSubgroupFilter('');
    }
  };

  const clearSubgroupSelections = (deletedSubgroupName: string) => {
    if (subgroupName === deletedSubgroupName) {
      setSubgroupName('');
    }
    if (manageSubgroupName === deletedSubgroupName) {
      setManageSubgroupName('');
    }
    if (listSubgroupFilter === deletedSubgroupName) {
      setListSubgroupFilter('');
    }
  };

  const handleDeleteGroup = async () => {
    if (!manageGroupName) {
      setError('Izaberite grupu koju želite da obrišete.');
      return;
    }

    const subgroupCount = getSubgroupOptions(manageGroupName).length;
    const confirmed = window.confirm(
      subgroupCount > 0
        ? `Da li želite da obrišete grupu "${manageGroupName}" i svih ${subgroupCount} podgrupa?`
        : `Da li želite da obrišete grupu "${manageGroupName}"?`,
    );
    if (!confirmed) return;

    setDeletingGroup(true);
    setError(null);

    try {
      if (isTaxonomyGroup(manageGroupName)) {
        await deleteTaxonomyGroup(manageGroupName);
      } else {
        setCustomGroups((prev) => prev.filter((item) => item !== manageGroupName));
        setCustomSubgroups((prev) => {
          const next = { ...prev };
          delete next[manageGroupName];
          return next;
        });
      }

      clearGroupSelections(manageGroupName);
      await loadArticleList(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neuspešno brisanje grupe.');
    } finally {
      setDeletingGroup(false);
    }
  };

  const handleDeleteSubgroup = async () => {
    if (!manageGroupName || !manageSubgroupName) {
      setError('Izaberite grupu i podgrupu koje želite da obrišete.');
      return;
    }

    const confirmed = window.confirm(`Da li želite da obrišete podgrupu "${manageSubgroupName}"?`);
    if (!confirmed) return;

    setDeletingSubgroup(true);
    setError(null);

    try {
      if (isTaxonomySubgroup(manageSubgroupName)) {
        await deleteTaxonomySubgroup(manageSubgroupName);
      } else {
        setCustomSubgroups((prev) => ({
          ...prev,
          [manageGroupName]: (prev[manageGroupName] ?? []).filter((item) => item !== manageSubgroupName),
        }));
      }

      clearSubgroupSelections(manageSubgroupName);
      await loadArticleList(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neuspešno brisanje podgrupe.');
    } finally {
      setDeletingSubgroup(false);
    }
  };

  const listSummaryLabel =
    listTotalCount === 0
      ? 'Nema artikala'
      : listArticles.length >= listTotalCount
        ? `Prikazano ${listTotalCount} od ${listTotalCount}`
        : `Prikazano ${listArticles.length} od ${listTotalCount}`;

  return (
    <div className="stack-v">
      <div className="panel stack-v">
        <div className="panel-header">
          <div className="stack-v">
            <div className="panel-title">Katalog artikala</div>
            <div className="panel-subtitle">
              Definišite dimenzije i slike artikala za planograme. Grupe i podgrupe se učitavaju iz Supabase
              taksonomije.
            </div>
          </div>
          <span className="badge">{taxonomyLoading ? 'Učitavanje grupa…' : 'Podaci Supabase'}</span>
        </div>

        <form className="stack-v" onSubmit={handleCreate}>
          <div className="form-grid">
            <label className="form-row">
              <span className="muted">Naziv</span>
              <input
                className="input"
                type="text"
                placeholder="npr. Kutija cerealija"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <label className="form-row">
              <span className="muted">Širina (mm)</span>
              <input
                className="input"
                type="number"
                min={1}
                step={1}
                value={widthMm}
                onChange={(event) => setWidthMm(event.target.value)}
                required
              />
            </label>
            <label className="form-row">
              <span className="muted">Visina (mm)</span>
              <input
                className="input"
                type="number"
                min={1}
                step={1}
                value={heightMm}
                onChange={(event) => setHeightMm(event.target.value)}
                required
              />
            </label>
            <label className="form-row">
              <span className="muted">Dubina (mm, opciono)</span>
              <input
                className="input"
                type="number"
                min={0}
                step={1}
                value={depthMm}
                onChange={(event) => setDepthMm(event.target.value)}
              />
            </label>
            <label className="form-row">
              <span className="muted">Slika (opciono)</span>
              <input className="input" type="file" accept="image/*" onChange={handleFileChange} />
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={removeWhiteBg}
                  onChange={(event) => setRemoveWhiteBg(event.target.checked)}
                />
                <span className="muted">Ukloni belu pozadinu sa slike</span>
              </label>
            </label>
            <label className="form-row">
              <span className="muted">Grupa</span>
              <select
                className="input"
                value={groupName}
                onChange={(event) => {
                  setGroupName(event.target.value);
                  setSubgroupName('');
                }}
              >
                <option value="">Bez grupe</option>
                {groupOptions.map((group) => (
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
                value={subgroupName}
                onChange={(event) => setSubgroupName(event.target.value)}
                disabled={!groupName}
              >
                <option value="">Bez podgrupe</option>
                {groupName &&
                  getSubgroupOptions(groupName).map((subgroup) => (
                    <option key={subgroup.value} value={subgroup.value}>
                      {subgroup.label}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <div className="stack-h">
            <button type="button" className="btn-ghost" onClick={handleAddGroup}>
              + Nova grupa
            </button>
            <button type="button" className="btn-ghost" onClick={handleAddSubgroup} disabled={!groupName}>
              + Nova podgrupa
            </button>
          </div>

          <div className="taxonomy-manage stack-v">
            <div className="panel-subtitle">Brisanje grupa i podgrupa</div>
            <div className="form-grid">
              <label className="form-row">
                <span className="muted">Grupa za brisanje</span>
                <select
                  className="input"
                  value={manageGroupName}
                  onChange={(event) => {
                    setManageGroupName(event.target.value);
                    setManageSubgroupName('');
                  }}
                >
                  <option value="">Izaberite grupu</option>
                  {groupOptions.map((group) => (
                    <option key={group.value} value={group.value}>
                      {group.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-row">
                <span className="muted">Podgrupa za brisanje</span>
                <select
                  className="input"
                  value={manageSubgroupName}
                  onChange={(event) => setManageSubgroupName(event.target.value)}
                  disabled={!manageGroupName}
                >
                  <option value="">Izaberite podgrupu</option>
                  {manageSubgroupOptions.map((subgroup) => (
                    <option key={subgroup.value} value={subgroup.value}>
                      {subgroup.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="stack-h">
              <button
                type="button"
                className="btn-danger-ghost"
                onClick={() => void handleDeleteGroup()}
                disabled={!manageGroupName || deletingGroup}
              >
                {deletingGroup ? 'Brisanje…' : 'Obriši grupu i podgrupe'}
              </button>
              <button
                type="button"
                className="btn-danger-ghost"
                onClick={() => void handleDeleteSubgroup()}
                disabled={!manageGroupName || !manageSubgroupName || deletingSubgroup}
              >
                {deletingSubgroup ? 'Brisanje…' : 'Obriši podgrupu'}
              </button>
            </div>
          </div>

          {error && <div className="error-text">{error}</div>}

          <div className="stack-h-between">
            <button type="submit" className="btn" disabled={saving}>
              {saving ? 'Čuvanje…' : 'Dodaj artikl'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => void loadArticleList(true)} disabled={listLoading}>
              {listLoading ? 'Osvežavanje…' : 'Osveži listu'}
            </button>
          </div>
        </form>
      </div>

      <div className="panel stack-v">
        <div className="panel-header">
          <div className="stack-v">
            <div className="panel-title">Vaši artikli</div>
            <div className="panel-subtitle">
              Artikli se učitavaju po stranicama ({ARTICLE_LIST_PAGE_SIZE} po učitavanju). Koristite filtere da suzite
              listu.
            </div>
          </div>
          <span className="badge">{listSummaryLabel}</span>
        </div>

        {listLoading && listArticles.length === 0 ? (
          <p className="muted">Učitavanje artikala…</p>
        ) : listTotalCount === 0 ? (
          <p className="muted">Još nema artikala. Dodajte jedan iznad da počnete katalog.</p>
        ) : (
          <div className="stack-v">
            <div className="form-grid">
              <label className="form-row">
                <span className="muted">Grupa</span>
                <select
                  className="input"
                  value={listGroupFilter}
                  onChange={(event) => {
                    setListGroupFilter(event.target.value);
                    setListSubgroupFilter('');
                  }}
                >
                  <option value="">Sve grupe</option>
                  {groupOptions.map((group) => (
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
                  value={listSubgroupFilter}
                  onChange={(event) => setListSubgroupFilter(event.target.value)}
                  disabled={!listGroupFilter}
                >
                  <option value="">Sve podgrupe</option>
                  {listGroupFilter &&
                    getSubgroupOptions(listGroupFilter).map((subgroup) => (
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
                  placeholder="Kucajte za filtriranje…"
                  value={listNameFilter}
                  onChange={(event) => setListNameFilter(event.target.value)}
                />
              </label>
            </div>

            {listArticles.length === 0 ? (
              <p className="muted">Nijedan artikl ne odgovara filterima.</p>
            ) : (
              <>
                <div className="article-list">
                  {listArticles.map((article) => (
                    <div key={article.id} className="article-list-row stack-h-between">
                      <div className="stack-h">
                        {article.imageUrl && (
                          <img
                            src={article.imageUrl}
                            alt={article.name}
                            style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 8, background: '#f5f5f5' }}
                          />
                        )}
                        <div className="stack-v">
                          <div>{article.name}</div>
                          <div className="metric">{formatArticleDimensions(article)}</div>
                          {(article.group_name || article.subgroup_name) && (
                            <div className="metric">
                              {article.group_name && <strong>{article.group_name}</strong>}
                              {article.group_name && article.subgroup_name && ' · '}
                              {article.subgroup_name}
                            </div>
                          )}
                        </div>
                      </div>
                      <button type="button" className="btn-ghost" onClick={() => void handleDeleteArticle(article)}>
                        Obriši
                      </button>
                    </div>
                  ))}
                </div>

                {listHasMore && (
                  <div>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => void loadArticleList(false, listArticles.length)}
                      disabled={listLoadingMore}
                    >
                      {listLoadingMore
                        ? 'Učitavanje…'
                        : `Učitaj još ${Math.min(ARTICLE_LIST_PAGE_SIZE, listTotalCount - listArticles.length)}`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
