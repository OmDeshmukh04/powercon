import type { ReactElement } from 'react';
import InvoiceDashboard from '../pages/InvoiceDashboard';
import Invoices from '../pages/Invoices';
import Collections from '../pages/Collections';
import Customers from '../pages/Customers';
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
  { path: '/invoices',          title: 'Invoices',          section: 'Dashboards', icon: '📄', roles: ['admin', 'finance', 'support'], element: <Invoices /> },
  { path: '/collections',       title: 'Collections',       section: 'Dashboards', icon: '📥', roles: ['admin', 'finance', 'support'], element: <Collections /> },
  { path: '/customers',         title: 'Customers',         section: 'Dashboards', icon: '🏢', roles: ['admin', 'finance', 'support'], element: <Customers /> },
  { path: '/uploads',           title: 'Uploads',           section: 'Admin',       icon: '📤', roles: ['admin'],                       element: <Uploads /> },
  { path: '/profile',           title: 'Profile',           section: 'Account',     icon: '👤', roles: ['admin', 'finance', 'support'],  element: <Profile /> },
  { path: '/settings',          title: 'Settings',          section: 'Account',     icon: '🔧', roles: ['admin', 'finance', 'support'],  element: <Settings /> },
];

export const routeSections = ['Dashboards', 'Admin', 'Account'] as const;
