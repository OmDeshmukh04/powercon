import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppSelector } from '../redux/hooks';
import type { AppRole } from '../types/auth';
import { appRoutes } from './routeConfig';
import { ROLE_HOME_PATHS } from '../utils/roles';

export default function ProtectedRoute({ allowedRoles }: { allowedRoles?: AppRole[] }) {
  const location = useLocation();
  const { user, status } = useAppSelector(state => state.auth);
  const currentRoute = appRoutes.find(route => route.path === location.pathname);
  const routeRoles = allowedRoles ?? currentRoute?.roles;

  if (status === 'loading') {
    return <div className="page-wrap"><div className="loading">Loading...</div></div>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (routeRoles && !routeRoles.includes(user.role)) {
    return <Navigate to={ROLE_HOME_PATHS[user.role]} replace />;
  }

  return <Outlet />;
}
