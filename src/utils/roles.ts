import type { User as ApiUser } from '../types';
import type { AppRole, AppUser } from '../types/auth';

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Admin',
  finance: 'Finance',
  support: 'Support',
  provider: 'Provider',
};

export const ROLE_HOME_PATHS: Record<AppRole, string> = {
  admin:    '/invoice-dashboard',
  finance:  '/invoice-dashboard',
  support:  '/invoice-dashboard',
  provider: '/invoice-dashboard',
};

export const API_ROLE_TO_APP_ROLE = (role?: string | null): AppRole => {
  const normalized = (role ?? '').toLowerCase();
  if (normalized === 'admin') return 'admin';
  if (normalized === 'finance') return 'finance';
  if (normalized === 'support') return 'support';
  if (normalized === 'provider') return 'provider';
  return 'support';
};

export const toAppUser = (user: ApiUser & { provider_id?: string | null }): AppUser => ({
  id: user.id,
  email: user.email,
  full_name: user.full_name ?? null,
  role: API_ROLE_TO_APP_ROLE(user.role),
  rawRole: user.role || '',
  provider_id: user.provider_id ?? null,
  is_active: Boolean(user.is_active),
  tenant_id: 'tenant_id' in user ? user.tenant_id ?? null : null,
});
