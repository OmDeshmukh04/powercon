import type { AppUser } from '../types/auth';
import { toAppUser } from './roles';
import api from '../api';

export async function fetchCurrentUser(token: string): Promise<AppUser> {
  // Use shared axios instance so baseURL, auth, and tenant header are consistent.
  // We still pass Authorization explicitly to ensure bootstrap works even before
  // interceptors run or localStorage is populated in some edge cases.
  const response = await api.get('/v1/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return toAppUser(response.data as any);
}
