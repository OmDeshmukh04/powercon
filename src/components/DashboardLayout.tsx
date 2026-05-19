import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAppDispatch, useAppSelector } from '../redux/hooks';
import { toggleSidebar, toggleUserMenu, closeUserMenu } from '../redux/uiSlice';
import { signOut } from '../redux/authSlice';
import { appRoutes } from '../routes/routeConfig';
import { ROLE_HOME_PATHS } from '../utils/roles';
import { getReconSummary } from '../api';
import logoImage from '../assets/image.png';
import '../pages/AccessFrontend.css';

export default function DashboardLayout() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const dispatch  = useAppDispatch();
  const { user }  = useAppSelector(state => state.auth);
  const { sidebarOpen, userMenuOpen } = useAppSelector(state => state.ui);

  const [reconWarnings, setReconWarnings] = useState<string[]>([]);
  const [notifOpen,     setNotifOpen]     = useState(false);

  const notifWrapRef = useRef<HTMLDivElement>(null);
  const userMenuRef  = useRef<HTMLDivElement>(null);

  /* ── Derived ── */
  const activeRoute = useMemo(
    () =>
      appRoutes.find(r => r.path === location.pathname) ??
      appRoutes.find(r => location.pathname.startsWith(r.path)),
    [location.pathname],
  );

  const roleLabel = useMemo(() => {
    const role = user?.role ?? 'user';
    return role.charAt(0).toUpperCase() + role.slice(1);
  }, [user?.role]);

  const breadcrumbSection = activeRoute?.section ?? 'Dashboards';
  const breadcrumbTitle   = activeRoute?.title   ?? 'Overview';

  /* ── Poll recon warnings — delayed initial load + every 5 min ── */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const summary = await getReconSummary();
        const noCharge  = summary.rows.find(r => r.status === 'checkout_no_charge')?.count  ?? 0;
        const noEra     = summary.rows.find(r => r.status === 'checkout_charge_no_era')?.count ?? 0;
        const msgs: string[] = [];
        if (noCharge > 0) msgs.push(`${noCharge} checkout${noCharge > 1 ? 's' : ''} without charge`);
        if (noEra    > 0) msgs.push(`${noEra} charge${noEra > 1 ? 's' : ''} missing ERA`);
        if (alive) setReconWarnings(msgs);
      } catch {
        if (alive) setReconWarnings([]);
      }
    };
    // Delay initial fetch by 5s so dashboard data loads first
    const initialDelay = window.setTimeout(() => {
      if (alive) void load();
    }, 5000);
    const interval = window.setInterval(load, 5 * 60 * 1000);
    return () => { alive = false; window.clearTimeout(initialDelay); window.clearInterval(interval); };
  }, []);

  /* ── Close notif on outside click ── */
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (notifWrapRef.current && !notifWrapRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  /* ── Close user-menu on outside click ── */
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) dispatch(closeUserMenu());
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [dispatch]);

  /* ── Close everything on route change ── */
  useEffect(() => {
    setNotifOpen(false);
    dispatch(closeUserMenu());
  }, [location.pathname, dispatch]);

  function handleLogout() {
    dispatch(closeUserMenu());
    dispatch(signOut());
    navigate('/login');
  }

  return (
    <div className="capsurge-app">
      <nav className="navbar">
        {/* Hamburger — visible on mobile only (CSS hides on desktop) */}
        <button
          type="button"
          className="nb-hamburger"
          aria-label="Toggle navigation menu"
          aria-expanded={sidebarOpen}
          onClick={() => dispatch(toggleSidebar())}
        >
          ☰
        </button>

        {/* Brand */}
        <div className="nb-sidebar-space">
          <div
            className="nb-brand"
            role="link"
            tabIndex={0}
            aria-label="Empowered Mind-Body Therapy home"
            onClick={() => navigate(ROLE_HOME_PATHS[user?.role ?? 'admin'])}
            onKeyDown={e => e.key === 'Enter' && navigate(ROLE_HOME_PATHS[user?.role ?? 'admin'])}
          >
            <div className="nb-brand-mark" aria-hidden="true">
              <img src={logoImage} alt="Empowered Mind-Body Therapy" className="nb-logo" />
            </div>
            <div className="nb-brand-copy">
              <div className="nb-brand-name">Empowered Mind-Body Therapy</div>
            </div>
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="nb-title" aria-label="Current page breadcrumb">
          <span className="nb-breadcrumb-parent">{breadcrumbSection}</span>
          <span className="nb-breadcrumb-sep">/</span>
          <span className="nb-breadcrumb-current">{breadcrumbTitle}</span>
        </div>

        <div className="nb-right">
          {/* ── Notification bell ── */}
          <div className="nb-notify-wrap" ref={notifWrapRef}>
            <button
              type="button"
              className="nb-icon-btn nb-icon-btn-bell"
              aria-label={`Notifications${reconWarnings.length > 0 ? ` (${reconWarnings.length} warning${reconWarnings.length > 1 ? 's' : ''})` : ''}`}
              aria-expanded={notifOpen}
              onClick={() => setNotifOpen(p => !p)}
            >
              <span aria-hidden="true">🔔</span>
              {reconWarnings.length > 0 && (
                <span className="nb-notify-count" aria-hidden="true">{reconWarnings.length}</span>
              )}
            </button>
            {notifOpen && (
              <div className="nb-notify-pop" role="menu" aria-label="Notification warnings">
                <div className="nb-notify-title">Notifications</div>
                {reconWarnings.length ? (
                  reconWarnings.map(w => (
                    <div key={w} className="nb-notify-item nb-notify-item-warn" role="menuitem">
                      <span className="nb-notify-item-icon" aria-hidden="true">⚠</span>
                      <span>{w}</span>
                    </div>
                  ))
                ) : (
                  <div className="nb-notify-item" role="menuitem">No active warnings</div>
                )}
              </div>
            )}
          </div>

          {/* ── User dropdown ── */}
          <div ref={userMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="nb-user"
              aria-label="User menu"
              aria-expanded={userMenuOpen}
              aria-haspopup="menu"
              onClick={() => dispatch(toggleUserMenu())}
            >
              <span className="nb-av" aria-hidden="true">
                {user?.full_name?.slice(0, 1).toUpperCase() ?? 'U'}
              </span>
              <span className="nb-user-meta">
                <span className="nb-uname">{user?.full_name ?? 'User'}</span>
                <span className="nb-urole">{roleLabel}</span>
              </span>
              <span className="nb-chevron" aria-hidden="true">{userMenuOpen ? '▲' : '▼'}</span>
            </button>

            {userMenuOpen && (
              <div className="nb-user-dropdown" role="menu" aria-label="User options">
                <div className="nb-user-dropdown-header">
                  <div className="nb-user-dropdown-name">{user?.full_name ?? 'User'}</div>
                  <div className="nb-user-dropdown-role">{user?.email ?? roleLabel}</div>
                </div>
                <button
                  className="nb-user-dd-item"
                  role="menuitem"
                  onClick={() => { dispatch(closeUserMenu()); navigate('/profile'); }}
                >
                  <span aria-hidden="true">👤</span> My Profile
                </button>
                <button
                  className="nb-user-dd-item"
                  role="menuitem"
                  onClick={() => { dispatch(closeUserMenu()); navigate('/settings'); }}
                >
                  <span aria-hidden="true">⚙️</span> Settings
                </button>
                <div className="nb-user-dd-sep" aria-hidden="true" />
                <button className="nb-user-dd-item danger" role="menuitem" onClick={handleLogout}>
                  <span aria-hidden="true">🚪</span> Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <div className="capsurge-shell">
        <Sidebar />
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
