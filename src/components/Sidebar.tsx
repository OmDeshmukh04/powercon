import { NavLink } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { routeSections, appRoutes } from '../routes/routeConfig';
import { useAppDispatch, useAppSelector } from '../redux/hooks';
import { closeSidebar } from '../redux/uiSlice';
import { signOut } from '../redux/authSlice';
import capsurgeLogo from '/login-logo.webp';

export default function Sidebar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user } = useAppSelector(state => state.auth);
  const { sidebarOpen } = useAppSelector(state => state.ui);

  const allowedRoutes = appRoutes.filter(route => user && route.roles.includes(user.role));

  return (
    <>
      <div className={`sidebar-backdrop${sidebarOpen ? ' open' : ''}`} onClick={() => dispatch(closeSidebar())} />
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`} aria-label="Sidebar navigation">
        {routeSections.map(section => {
          const sectionRoutes = allowedRoutes.filter(route => route.section === section);
          if (!sectionRoutes.length) {
            return null;
          }

          return (
            <div key={section} className="sb-section">
              <div className="sb-label">{section}</div>
              {sectionRoutes.map(route => (
                <NavLink
                  key={route.path}
                  to={route.path}
                  end
                  className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}
                  onClick={() => dispatch(closeSidebar())}
                >
                  <span className="sb-icon">{route.icon}</span>
                  <span>{route.title}</span>
                </NavLink>
              ))}
              {section === 'Account' && (
                <button
                  type="button"
                  className="sb-item sb-logout"
                  onClick={() => { dispatch(signOut()); dispatch(closeSidebar()); navigate('/login'); }}
                >
                  <span className="sb-icon">🚪</span>
                  <span>Logout</span>
                </button>
              )}
            </div>
          );
        })}

        <div className="sb-spacer" />

        <div className="sb-bottom">
          <div className="sb-powered">
            <span className="sb-powered-label">Powered by</span>
            <img src={capsurgeLogo} alt="CapSurge" className="sb-powered-logo" />
          </div>
        </div>
      </aside>
    </>
  );
}
