import type { ReactElement } from 'react';
import ProviderDashboard from '../pages/ProviderDashboard';
import OperationalDashboard from '../pages/OperationalDashboard';
import Uploads from '../pages/Uploads';
import Reports from '../pages/Reports';
import Manage from '../pages/Manage';
import LockPeriods from '../pages/LockPeriods';
import Profile from '../pages/Profile';
import Settings from '../pages/Settings';
import type { AppRole } from '../types/auth';

export interface AppRouteItem {
  path: string;
  title: string;
  section: 'Dashboards' | 'Admin' | 'Account';
  icon: string;
  roles: AppRole[];
  element: ReactElement;
}

export const appRoutes: AppRouteItem[] = [
  { path: '/provider-dashboard', title: 'Provider Dashboard', section: 'Dashboards', icon: '📅', roles: ['admin', 'finance', 'support', 'provider'], element: <ProviderDashboard /> },
  { path: '/operational-dashboard', title: 'Operational Dashboard', section: 'Dashboards', icon: '💰', roles: ['admin', 'finance'], element: <OperationalDashboard /> },
  { path: '/uploads', title: 'Uploads', section: 'Admin', icon: '📤', roles: ['admin'], element: <Uploads /> },
  { path: '/reports', title: 'Reports', section: 'Admin', icon: '📊', roles: ['admin', 'finance', 'support'], element: <Reports /> },
  { path: '/manage', title: 'Manage', section: 'Admin', icon: '⚙️', roles: ['admin'], element: <Manage /> },
  { path: '/profile', title: 'Profile', section: 'Account', icon: '👤', roles: ['admin', 'finance', 'support', 'provider'], element: <Profile /> },
  { path: '/settings', title: 'Settings', section: 'Account', icon: '🔧', roles: ['admin', 'finance', 'support', 'provider'], element: <Settings /> },
  { path: '/lock-periods', title: 'Lock Periods', section: 'Account', icon: '🔒', roles: ['admin', 'finance'], element: <LockPeriods /> },
];

export const routeSections = ['Dashboards', 'Admin', 'Account'] as const;
