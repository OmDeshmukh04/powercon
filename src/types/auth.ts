export type AppRole = 'admin' | 'finance' | 'support' | 'provider';

export interface AppUser {
  id: number;
  email: string;
  full_name?: string | null;
  role: AppRole;
  rawRole?: string;
  provider_id?: string | null;
  is_active?: boolean;
  tenant_id?: string | null;
}

export interface AuthState {
  user: AppUser | null;
  token: string | null;
  status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated';
  error: string | null;
}
