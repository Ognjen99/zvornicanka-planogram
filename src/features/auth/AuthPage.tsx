import { FormEvent, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const brandLogo = new URL('../../../images/welcomelogo.png', import.meta.url).href;

type Mode = 'sign-in' | 'sign-up';

export function AuthPage() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (mode === 'sign-in') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setError(signInError.message);
        }
      } else {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) {
          setError(signUpError.message);
        } else {
          setMessage('Nalog je kreiran. Proverite dolaznu poštu radi potvrde, ako projekat to zahteva.');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neočekivana greška');
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode((prev) => (prev === 'sign-in' ? 'sign-up' : 'sign-in'));
    setError(null);
    setMessage(null);
  };

  return (
    <div className="auth-shell">
      <div className="panel stack-v">
        <div className="auth-brand-wrap">
          <div className="brand-logo brand-logo-auth">
            <img src={brandLogo} alt="Marketi logo" className="auth-logo-image" />
          </div>
        </div>

        <div className="stack-h-between">
          <div className="stack-v">
            <div className="auth-heading">
              {mode === 'sign-in' ? 'Prijavite se na planograme' : 'Kreirajte svoj radni prostor za planograme'}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="stack-v">
          <div className="form-grid">
            <label className="form-row">
              <span className="muted">E-pošta</span>
              <input
                className="input"
                type="email"
                required
                autoComplete="email"
                placeholder="vi@prodavnica.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="form-row">
              <span className="muted">Lozinka</span>
              <div className="password-input-wrap">
                <input
                  className="input password-input"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Sakrij lozinku' : 'Prikaži lozinku'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Sakrij' : 'Prikaži'}
                </button>
              </div>
            </label>
          </div>

          {error && <div className="error-text">{error}</div>}
          {message && <div className="success-text">{message}</div>}

          <div className="stack-h-between">
            <button type="submit" className="btn" disabled={loading}>
              {loading ? 'Čekajte…' : mode === 'sign-in' ? 'Prijavi se' : 'Kreiraj nalog'}
            </button>
            <button type="button" className="btn-ghost" onClick={toggleMode}>
              {mode === 'sign-in' ? 'Nemate nalog?' : 'Već imate nalog?'}
            </button>
          </div>
        </form>

        <EnvFooter />
      </div>
    </div>
  );
}

function EnvFooter() {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const missing = !url || !key;
  const looksPlaceholder =
    url?.includes('your-project-id') ||
    key === 'your-anon-key-here' ||
    key === 'anon-key-placeholder';

  if (missing || looksPlaceholder) {
    return (
      <div className="auth-footer">
        Za programere: postavite <code>VITE_SUPABASE_URL</code> i <code>VITE_SUPABASE_ANON_KEY</code> u lokalnom{' '}
        <code>.env</code> fajlu, pa ponovo pokrenite <code>npm run dev</code>.
      </div>
    );
  }
}
