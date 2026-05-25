import { useEffect, useMemo, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabaseClient';
import { AuthPage } from './features/auth/AuthPage';
import { ArticlesPage } from './features/articles/ArticlesPage';
import { ShelvesPage } from './features/shelves/ShelvesPage';
import { PlanogramEditorPage } from './features/planogram/PlanogramEditorPage';
import { PrintViewPage } from './features/print/PrintViewPage';

const brandLogo = new URL('../images/welcomelogo.png', import.meta.url).href;

function useAuthSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!isMounted) return;
        setSession(data.session ?? null);
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    const {
      data: subscription,
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      isMounted = false;
      subscription.subscription?.unsubscribe();
    };
  }, []);

  return { session, loading };
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeKey = useMemo(() => {
    if (location.pathname.startsWith('/articles')) return 'articles';
    if (location.pathname.startsWith('/shelves')) return 'shelves';
    if (location.pathname.startsWith('/planogram')) return 'planogram';
    if (location.pathname.startsWith('/print')) return 'print';
    return 'planogram';
  }, [location.pathname]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="stack-h-between app-header-top">
          <div className="stack-h">
            <div className="brand-logo brand-logo-header">
              <img src={brandLogo} alt="Marketi logo" className="auth-logo-image" />
            </div>
            <div>
              <div className="app-title">Planogram</div>
            </div>
          </div>
          <div className="stack-h">
            <span className="badge">Prijavljeni</span>
            <button type="button" className="btn-ghost" onClick={handleSignOut}>
              Odjavi se
            </button>
          </div>
        </div>

        <nav className="app-header-nav">
          <button
            type="button"
            className={`sidebar-link header-link ${activeKey === 'planogram' ? 'sidebar-link-active' : ''}`}
            onClick={() => navigate('/planogram')}
          >
            <span>Planogram</span>
            {activeKey === 'planogram' && <span className="sidebar-link-indicator" />}
          </button>
          <button
            type="button"
            className={`sidebar-link header-link ${activeKey === 'articles' ? 'sidebar-link-active' : ''}`}
            onClick={() => navigate('/articles')}
          >
            <span>Katalog artikala</span>
            {activeKey === 'articles' && <span className="sidebar-link-indicator" />}
          </button>
          <button
            type="button"
            className={`sidebar-link header-link ${activeKey === 'shelves' ? 'sidebar-link-active' : ''}`}
            onClick={() => navigate('/shelves')}
          >
            <span>Šabloni polica</span>
            {activeKey === 'shelves' && <span className="sidebar-link-indicator" />}
          </button>
          <button
            type="button"
            className={`sidebar-link header-link ${activeKey === 'print' ? 'sidebar-link-active' : ''}`}
            onClick={() => navigate('/print')}
          >
            <span>Pregled štampe A4</span>
            {activeKey === 'print' && <span className="sidebar-link-indicator" />}
          </button>
        </nav>
      </header>

      <main className="app-main">
        <section className="app-content">
          <Routes>
            <Route path="/articles" element={<ArticlesPage />} />
            <Route path="/shelves" element={<ShelvesPage />} />
            <Route path="/planogram" element={<PlanogramEditorPage />} />
            <Route path="/print" element={<PrintViewPage />} />
            <Route path="*" element={<PlanogramEditorPage />} />
          </Routes>
        </section>
      </main>
    </div>
  );
}

export default function App() {
  const { session, loading } = useAuthSession();

  if (loading) {
    return (
      <div className="auth-shell">
        <div className="panel stack-v">
          <div className="stack-h">
            <div className="brand-logo brand-logo-auth">
              <img src={brandLogo} alt="Marketi logo" className="auth-logo-image" />
            </div>
            <div className="stack-v">
              <div className="auth-heading">Učitavanje radnog prostora</div>
              <div className="auth-subtitle">Provera sesije Supabase…</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return <AuthPage />;
  }

  return <AppShell />;
}

