import { Navigate, Route, Routes } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import ProtectedRoute from './ProtectedRoute';
import { appRoutes } from './routeConfig';
import Login from '../pages/Login';
import { ROLE_HOME_PATHS } from '../utils/roles';
import { useAppSelector } from '../redux/hooks';

function RoleRedirect() {
  const { user } = useAppSelector(state => state.auth);
  return <Navigate to={user ? ROLE_HOME_PATHS[user.role] : '/login'} replace />;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route index element={<RoleRedirect />} />
          {appRoutes.map(route => (
            <Route key={route.path} path={route.path.slice(1)} element={route.element} />
          ))}
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
