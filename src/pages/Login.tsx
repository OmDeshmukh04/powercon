import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../redux/store';
import { signIn } from '../redux/authSlice';
import { ROLE_HOME_PATHS } from '../utils/roles';

export default function Login() {
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  async function doLogin() {
    if (!email || !password) { setError('Please enter email and password.'); return; }
    setError('');
    setLoading(true);
    try {
      const result = await dispatch(signIn({ email, password }));
      if (signIn.fulfilled.match(result)) {
        navigate(ROLE_HOME_PATHS[result.payload.user.role]);
      } else {
        setError(result.error?.message || 'Invalid credentials.');
      }
    } finally {
      setLoading(false);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') doLogin();
  }

  return (
    <>
      <style>{`
        #login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #e8f0fb 0%, #f0f4f8 50%, #e4eef8 100%);
          position: relative;
          overflow: hidden;
        }
        #login-page::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(45,127,193,.12) 1px, transparent 1px),
            linear-gradient(90deg, rgba(45,127,193,.12) 1px, transparent 1px);
          background-size: 48px 48px;
          pointer-events: none;
        }
        .login-bg-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          pointer-events: none;
        }
        .login-wrap {
          background: #ffffff;
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 44px 40px;
          width: 400px;
          position: relative;
          z-index: 1;
          box-shadow: 0 24px 80px rgba(0,0,0,.12), 0 0 0 1px rgba(45,127,193,.06);
          animation: slideUp .5s var(--ease) both;
        }
        .lw-brand {
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 30px;
        }
        .lw-logo {
          width: 152px;
          height: auto;
          display: block;
        }
        .lw-title { font-size: 22px; font-weight: 700; letter-spacing: -.3px; margin-bottom: 4px; }
        .lw-sub   { font-size: 13px; color: var(--text2); margin-bottom: 28px; }
        .lf-group { margin-bottom: 16px; }
        .lf-group label {
          display: block;
          font-size: 12px;
          font-weight: 600;
          color: var(--text3);
          letter-spacing: .6px;
          text-transform: uppercase;
          margin-bottom: 7px;
        }
        .lf-group input {
          width: 100%;
          padding: 11px 14px;
          background: var(--bg3);
          border: 1px solid var(--border);
          border-radius: var(--r-sm);
          color: var(--text);
          font-family: var(--font);
          font-size: 13.5px;
          outline: none;
          transition: border-color .15s, box-shadow .15s;
        }
        .lf-group input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-g);
        }
        .lf-row { display: flex; justify-content: flex-end; margin: 10px 0 22px; }
        .lf-forgot { font-size: 12px; color: var(--accent); cursor: pointer; opacity: .8; transition: opacity .15s; }
        .lf-forgot:hover { opacity: 1; text-decoration: underline; }
        .lf-btn {
          width: 100%;
          padding: 12px;
          background: linear-gradient(135deg, var(--accent), #1a4a72);
          border: none;
          border-radius: var(--r-sm);
          color: #fff;
          font-family: var(--font);
          font-size: 14.5px;
          font-weight: 700;
          cursor: pointer;
          letter-spacing: .2px;
          transition: opacity .15s, transform .15s, box-shadow .15s;
        }
        .lf-btn:hover:not(:disabled) {
          opacity: .9;
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(45,127,193,.4);
        }
        .lf-btn:disabled { opacity: .6; cursor: not-allowed; }
        .lf-error {
          background: var(--red-g);
          border: 1px solid rgba(220,53,69,.2);
          border-radius: var(--r-sm);
          padding: 10px 14px;
          font-size: 13px;
          color: var(--red);
          margin-bottom: 14px;
        }
      `}</style>

      <div id="login-page">
        <div className="login-bg-blob" style={{ width: 500, height: 500, background: 'rgba(45,127,193,.07)', top: -100, left: -150 }} />
        <div className="login-bg-blob" style={{ width: 400, height: 400, background: 'rgba(30,90,142,.05)', bottom: -50, right: -100 }} />
        <div className="login-bg-blob" style={{ width: 200, height: 200, background: 'rgba(154,165,180,.04)', top: '40%', left: '60%' }} />

        <div className="login-wrap">
          <div className="lw-brand">
            <img src="/login-logo.webp" alt="CapSurge" className="lw-logo" />
          </div>

          <div className="lw-title">Sign in</div>
          <div className="lw-sub">Healthcare billing intelligence platform</div>

          {error && <div className="lf-error">⚠️ {error}</div>}

          <div className="lf-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={onKey}
              placeholder="your@email.com"
            />
          </div>

          <div className="lf-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onKey}
              placeholder="••••••••"
            />
          </div>

          <div className="lf-row">
            <span className="lf-forgot">Forgot password?</span>
          </div>

          <button className="lf-btn" onClick={doLogin} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in to CapSurge →'}
          </button>
        </div>
      </div>
    </>
  );
}