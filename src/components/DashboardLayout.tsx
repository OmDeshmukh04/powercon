import { useEffect, useMemo, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAppDispatch, useAppSelector } from '../redux/hooks';
import { toggleSidebar, toggleUserMenu, closeUserMenu } from '../redux/uiSlice';
import { signOut } from '../redux/authSlice';
import { appRoutes } from '../routes/routeConfig';
import { ROLE_HOME_PATHS } from '../utils/roles';
import '../pages/AccessFrontend.css';

export default function DashboardLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { user } = useAppSelector(state => state.auth);
  const { sidebarOpen, userMenuOpen } = useAppSelector(state => state.ui);

  const userMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node))
        dispatch(closeUserMenu());
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [dispatch]);

  useEffect(() => {
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
        <button
          type="button"
          className="nb-hamburger"
          aria-label="Toggle navigation menu"
          aria-expanded={sidebarOpen}
          onClick={() => dispatch(toggleSidebar())}
        >
          ☰
        </button>

        <div className="nb-sidebar-space">
          <div
            className="nb-brand"
            role="link"
            tabIndex={0}
            aria-label="Powercon MIS home"
            onClick={() => navigate(ROLE_HOME_PATHS[user?.role ?? 'admin'])}
            onKeyDown={e => e.key === 'Enter' && navigate(ROLE_HOME_PATHS[user?.role ?? 'admin'])}
          >
            <div className="nb-brand-mark" aria-hidden="true">
              <img src="/powercon-logo.png" alt="Powercon" className="nb-logo" />
            </div>
          </div>
        </div>

        <div className="nb-title" aria-label="Current page breadcrumb">
          <span className="nb-breadcrumb-parent">{breadcrumbSection}</span>
          <span className="nb-breadcrumb-sep">/</span>
          <span className="nb-breadcrumb-current">{breadcrumbTitle}</span>
        </div>

        <div className="nb-right">
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
