import type { ReactElement } from 'react';
import InvoiceDashboard from '../pages/InvoiceDashboard';
import Uploads from '../pages/Uploads';
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
  { path: '/invoice-dashboard', title: 'Invoice Dashboard', section: 'Dashboards', icon: '🧾', roles: ['admin', 'finance', 'support'], element: <InvoiceDashboard /> },
  { path: '/uploads',           title: 'Uploads',           section: 'Admin',       icon: '📤', roles: ['admin'],                       element: <Uploads /> },
  { path: '/profile',           title: 'Profile',           section: 'Account',     icon: '👤', roles: ['admin', 'finance', 'support'],  element: <Profile /> },
  { path: '/settings',          title: 'Settings',          section: 'Account',     icon: '🔧', roles: ['admin', 'finance', 'support'],  element: <Settings /> },
];

export const routeSections = ['Dashboards', 'Admin', 'Account'] as const;
