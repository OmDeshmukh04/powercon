import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { login } from '../api';
import type { LoginRequest } from '../types';
import type { AppUser, AuthState } from '../types/auth';
import { fetchCurrentUser } from '../utils/session';

const TOKEN_KEY = 'token';

const initialState: AuthState = {
  user: null,
  token: localStorage.getItem(TOKEN_KEY),
  status: 'loading',
  error: null,
};

export const bootstrapAuth = createAsyncThunk('auth/bootstrap', async () => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    return { token: null, user: null as AppUser | null };
  }

  try {
    const user = await fetchCurrentUser(token);
    return { token, user };
  } catch (err) {
    console.error('bootstrapAuth: failed to fetch current user:', err);
    throw err;
  }
});

export const signIn = createAsyncThunk(
  'auth/signIn',
  async (payload: LoginRequest) => {
    const response = await login(payload);
    const token = response.access_token;

    if (!token) {
      throw new Error('Login succeeded but no token was returned');
    }

    localStorage.setItem(TOKEN_KEY, token);

    try {
      const user = await fetchCurrentUser(token);
      return { token, user };
    } catch (err: any) {
      // Token was saved but user fetch failed — clean up to avoid a broken state
      localStorage.removeItem(TOKEN_KEY);
      const detail =
        err?.response?.data?.detail?.message ||
        err?.response?.data?.detail ||
        err?.message ||
        'Login succeeded but failed to load user profile';
      throw new Error(String(detail));
    }
  },
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    signOut(state) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem('session_error');
      state.user = null;
      state.token = null;
      state.status = 'unauthenticated';
      state.error = null;
    },
    clearAuthError(state) {
      state.error = null;
    },
  },
  extraReducers: builder => {
    builder
      .addCase(bootstrapAuth.pending, state => {
        state.status = 'loading';
      })
      .addCase(bootstrapAuth.fulfilled, (state, action) => {
        state.token = action.payload.token;
        state.user = action.payload.user;
        state.status = action.payload.user ? 'authenticated' : 'unauthenticated';
        state.error = null;
      })
      .addCase(bootstrapAuth.rejected, state => {
        // Guard: do not wipe state if signIn already authenticated the user.
        // Without this, a slow/failed bootstrapAuth can race with signIn and
        // log the user out immediately after a successful login.
        if (state.status !== 'authenticated') {
          localStorage.removeItem(TOKEN_KEY);
          state.token = null;
          state.user = null;
          state.status = 'unauthenticated';
        }
      })
      .addCase(signIn.pending, state => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(signIn.fulfilled, (state, action) => {
        state.token = action.payload.token;
        state.user = action.payload.user;
        state.status = 'authenticated';
        state.error = null;
      })
      .addCase(signIn.rejected, (state, action) => {
        state.status = 'unauthenticated';
        state.error = action.error.message ?? 'Unable to sign in';
      });
  },
});

export const { signOut, clearAuthError } = authSlice.actions;
export default authSlice.reducer;