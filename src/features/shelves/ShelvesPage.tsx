import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useState } from 'react';
import {
  getBayWidthsMm,
  hasCustomBayWidths,
  totalShelfWidthMm,
} from '../../lib/bayWidths';
import { supabase } from '../../lib/supabaseClient';

type ShelfRow = {
  id: string;
  user_id: string;
  name: string;
  bay_width_mm: number;
  shelf_depth_mm: number;
  shelf_count: number;
  bay_count?: number | null;
  bay_widths_mm?: unknown | null;
  shelf_height_mm?: number | null;
  shelf_clearances_mm: unknown | null;
};

export function ShelvesPage() {
  const [shelves, setShelves] = useState<ShelfRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [bayWidthMm, setBayWidthMm] = useState('');
  const [shelfDepthMm, setShelfDepthMm] = useState('');
  const [shelfCount, setShelfCount] = useState('4');
  const [bayCount, setBayCount] = useState('1');
  const [unevenBayWidths, setUnevenBayWidths] = useState(false);
  const [perBayWidths, setPerBayWidths] = useState<string[]>(['500']);
  const [shelfHeightMm, setShelfHeightMm] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadShelves();
  }, []);

  const loadShelves = async () => {
    setLoading(true);
    setError(null);

    const { data, error: queryError } = await supabase
      .from('shelves')
      .select('*')
      .order('created_at', { ascending: false });

    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return;
    }

    setShelves((data ?? []) as ShelfRow[]);
    setLoading(false);
  };

  const resetForm = () => {
    setName('');
    setBayWidthMm('');
    setShelfDepthMm('');
    setShelfCount('4');
    setBayCount('1');
    setUnevenBayWidths(false);
    setPerBayWidths(['500']);
    setShelfHeightMm('');
  };

  /** Keep per-bay width rows aligned when "Broj rafova" changes in uneven mode. */
  const handleBayCountChange = (event: ChangeEvent<HTMLInputElement>) => {
    const val = event.target.value;
    setBayCount(val);
    if (!unevenBayWidths) return;
    setPerBayWidths((prev) => {
      const n = Number(val);
      if (!Number.isInteger(n) || n <= 0) return prev;
      const fallbackSingle = bayWidthMm.trim() || prev[prev.length - 1]?.trim() || '500';
      const next: string[] = [];
      for (let i = 0; i < n; i++) {
        const existing = prev[i]?.trim();
        if (existing) {
          next.push(prev[i]);
        } else if (i > 0) {
          next.push(next[i - 1]!);
        } else {
          next.push(fallbackSingle);
        }
      }
      return next;
    });
  };

  const handleUnevenToggle = (checked: boolean) => {
    setUnevenBayWidths(checked);
    if (checked) {
      const baysRaw = Number(bayCount || '1');
      const bays = Number.isInteger(baysRaw) && baysRaw > 0 ? baysRaw : 1;
      const fallback = bayWidthMm.trim() || '500';
      const seed = Array.from({ length: bays }, (_, i) => perBayWidths[i] ?? fallback);
      setPerBayWidths(seed);
      if (!Number.isInteger(baysRaw) || baysRaw <= 0) {
        setBayCount(String(bays));
      }
    }
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const depth = Number(shelfDepthMm);
      const count = Number(shelfCount);
      const bays = Number(bayCount || '1');
      const height = shelfHeightMm ? Number(shelfHeightMm) : null;

      if (!name.trim()) {
        setError('Naziv je obavezan.');
        return;
      }

      let bayWidthsNumeric: number[] | null = null;
      let bayCountFinal = bays;
      let nominalBayMm: number;

      if (unevenBayWidths) {
        const parsed = perBayWidths.map((s) => Number(String(s).trim()));
        if (!Number.isInteger(bays) || bays <= 0) {
          setError('Broj rafova mora biti pozitivan ceo broj.');
          return;
        }
        if (parsed.length !== bays) {
          setError('Za svaki raf unesite širinu ili prilagodite broj rafova.');
          return;
        }
        for (let i = 0; i < parsed.length; i++) {
          if (!Number.isFinite(parsed[i]) || parsed[i] <= 0) {
            setError(`Širina rafa ${i + 1} mora biti pozitivan broj (mm).`);
            return;
          }
        }
        bayWidthsNumeric = parsed;
        bayCountFinal = parsed.length;
        nominalBayMm = parsed[0];
      } else {
        nominalBayMm = Number(bayWidthMm);
      }

      if (!unevenBayWidths) {
        if (!Number.isFinite(nominalBayMm) || nominalBayMm <= 0) {
          setError('Širina rafa mora biti pozitivan broj (mm).');
          return;
        }
        if (!Number.isInteger(bays) || bays <= 0) {
          setError('Broj rafova mora biti pozitivan ceo broj.');
          return;
        }
        bayCountFinal = bays;
      }

      if (!Number.isFinite(depth) || depth <= 0) {
        setError('Dubina police mora biti pozitivan broj (mm).');
        return;
      }
      if (!Number.isInteger(count) || count <= 0) {
        setError('Broj polica mora biti pozitivan ceo broj.');
        return;
      }
      if (height != null && (!Number.isFinite(height) || height <= 0)) {
        setError('Visina police mora biti pozitivan broj (mm) kada je uneta.');
        return;
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setError('Morate biti prijavljeni da biste kreirali šablone polica.');
        return;
      }

      const commonFields = {
        name: name.trim(),
        bay_width_mm: nominalBayMm,
        shelf_depth_mm: depth,
        shelf_count: count,
        bay_count: bayCountFinal,
        shelf_height_mm: height,
        bay_widths_mm: bayWidthsNumeric,
      };

      if (editingId) {
        const { error: updateError } = await supabase
          .from('shelves')
          .update(commonFields)
          .eq('id', editingId);

        if (updateError) {
          setError(updateError.message);
          return;
        }
      } else {
        const { error: insertError } = await supabase.from('shelves').insert({
          user_id: user.id,
          ...commonFields,
          shelf_clearances_mm: null,
        });

        if (insertError) {
          setError(insertError.message);
          return;
        }
      }

      resetForm();
      setEditingId(null);
      await loadShelves();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neočekivana greška pri čuvanju šablona police.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (shelf: ShelfRow) => {
    setError(null);
    try {
      const { error: deleteError } = await supabase.from('shelves').delete().eq('id', shelf.id);
      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      await loadShelves();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neočekivana greška pri brisanju šablona police.');
    }
  };

  const handleEdit = (shelf: ShelfRow) => {
    setEditingId(shelf.id);
    setName(shelf.name);
    setBayWidthMm(String(shelf.bay_width_mm));
    setShelfDepthMm(String(shelf.shelf_depth_mm));
    setShelfCount(String(shelf.shelf_count));
    const widths = getBayWidthsMm(shelf);
    const custom = hasCustomBayWidths(shelf);
    setUnevenBayWidths(custom);
    setBayCount(String(widths.length));
    setPerBayWidths(widths.map(String));
    setShelfHeightMm(shelf.shelf_height_mm != null ? String(shelf.shelf_height_mm) : '');
    setError(null);
  };

  return (
    <div className="stack-v">
      <div className="panel stack-v">
        <div className="panel-header">
          <div className="stack-v">
            <div className="panel-title">Šabloni polica</div>
            <div className="panel-subtitle">Kreirajte rafove sa prilagođenom širinom, dubinom i brojem polica.</div>
          </div>
          <span className="badge">{editingId ? 'Izmena šablona' : 'Podaci Supabase'}</span>
        </div>

        <form className="stack-v" onSubmit={handleCreate}>
          <div className="form-grid">
            <label className="form-row">
              <span className="muted">Naziv</span>
              <input
                className="input"
                type="text"
                placeholder="npr. Raf u prolazu za cerealije 1"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <label className="form-row" style={{ gridColumn: '1 / -1' }}>
              <span className="muted">Različite širine rafova</span>
              <label className="stack-h" style={{ gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={unevenBayWidths}
                  onChange={(event) => handleUnevenToggle(event.target.checked)}
                />
                <span>Unos širine za svaki raf posebno (levo → desno)</span>
              </label>
            </label>

            {!unevenBayWidths && (
              <label className="form-row">
                <span className="muted">Širina rafa (mm)</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  step={1}
                  value={bayWidthMm}
                  onChange={(event) => setBayWidthMm(event.target.value)}
                  required
                />
              </label>
            )}
            <label className="form-row">
              <span className="muted">Dubina police (mm)</span>
              <input
                className="input"
                type="number"
                min={1}
                step={1}
                value={shelfDepthMm}
                onChange={(event) => setShelfDepthMm(event.target.value)}
                required
              />
            </label>
            <label className="form-row">
              <span className="muted">Broj polica</span>
              <input
                className="input"
                type="number"
                min={1}
                step={1}
                value={shelfCount}
                onChange={(event) => setShelfCount(event.target.value)}
                required
              />
            </label>
            <label className="form-row">
              <span className="muted">Broj rafova (horizontalno)</span>
              <input
                className="input"
                type="number"
                min={1}
                step={1}
                value={bayCount}
                onChange={handleBayCountChange}
                required
              />
            </label>

            {unevenBayWidths && (
              <div className="form-row" style={{ gridColumn: '1 / -1' }}>
                <span className="muted">Širine rafova (mm)</span>
                <div
                  className="stack-v"
                  style={{ gap: '0.35rem', marginTop: '0.25rem' }}
                >
                  {perBayWidths.map((row, idx) => (
                    <label key={idx} className="stack-h" style={{ alignItems: 'center', gap: '0.35rem' }}>
                      <span className="muted" style={{ width: '4.25rem', flexShrink: 0 }}>
                        Raf {idx + 1}
                      </span>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        step={1}
                        value={row}
                        onChange={(event) =>
                          setPerBayWidths((prev) => prev.map((p, i) => (i === idx ? event.target.value : p)))
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
            <label className="form-row">
              <span className="muted">Visina police (mm, slobodan prostor)</span>
              <input
                className="input"
                type="number"
                min={1}
                step={1}
                value={shelfHeightMm}
                onChange={(event) => setShelfHeightMm(event.target.value)}
                placeholder="npr. 350 (opciono)"
              />
            </label>
          </div>

          {error && <div className="error-text">{error}</div>}

          <div className="stack-h-between">
            <button type="submit" className="btn" disabled={saving}>
              {saving ? 'Čuvanje…' : editingId ? 'Ažuriraj šablon police' : 'Dodaj šablon police'}
            </button>
            <button type="button" className="btn-ghost" onClick={loadShelves} disabled={loading}>
              {loading ? 'Osvežavanje…' : 'Osveži listu'}
            </button>
          </div>
        </form>
      </div>

      <div className="panel stack-v">
        <div className="panel-header">
          <div className="stack-v">
            <div className="panel-title">Vaši šabloni polica</div>
            <div className="panel-subtitle">
              Redovi u tabeli <code>shelves</code> u Supabase-u, filtrirani po vašem korisniku.
            </div>
          </div>
        </div>

        {loading ? (
          <p className="muted">Učitavanje šablona polica…</p>
        ) : shelves.length === 0 ? (
          <p className="muted">Još nema šablona polica. Dodajte jedan iznad za planiranje rafova.</p>
        ) : (
          <div className="stack-v">
            {shelves.map((shelf) => (
              <div key={shelf.id} className="stack-h-between">
                <div className="stack-v">
                  <div>{shelf.name}</div>
                  <div className="metric">
                    {hasCustomBayWidths(shelf) ? (
                      <>
                        Rafovi{' '}
                        <strong>{getBayWidthsMm(shelf).join(' / ')}</strong> mm (ukupno{' '}
                        <strong>{totalShelfWidthMm(getBayWidthsMm(shelf))}</strong> mm) · Dubina{' '}
                        <strong>{shelf.shelf_depth_mm}</strong> mm · Police <strong>{shelf.shelf_count}</strong>
                      </>
                    ) : (
                      <>
                        Širina <strong>{shelf.bay_width_mm}</strong> mm · Dubina{' '}
                        <strong>{shelf.shelf_depth_mm}</strong> mm · Police <strong>{shelf.shelf_count}</strong> · Rafovi{' '}
                        <strong>{shelf.bay_count == null ? 1 : shelf.bay_count}</strong>
                      </>
                    )}
                    {shelf.shelf_height_mm != null && (
                      <>
                        {' '}
                        · Visina <strong>{shelf.shelf_height_mm}</strong> mm
                      </>
                    )}
                  </div>
                </div>
                <div className="stack-h">
                  <button type="button" className="btn-ghost" onClick={() => handleEdit(shelf)}>
                    Izmeni
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => void handleDelete(shelf)}>
                    Obriši
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

