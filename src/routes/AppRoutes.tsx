import { Navigate, Route, Routes } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import ProtectedRoute from './ProtectedRoute';
import { appRoutes } from './routeConfig';
import Login from '../pages/Login';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          {appRoutes.map(route => (
            <Route key={route.path} path={route.path.slice(1)} element={route.element} />
          ))}
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
