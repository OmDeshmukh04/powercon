import { createSlice } from '@reduxjs/toolkit';

interface UiState {
  sidebarOpen: boolean;
  userMenuOpen: boolean;
}

const initialState: UiState = {
  sidebarOpen: false,
  userMenuOpen: false,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toggleSidebar(state) {
      state.sidebarOpen = !state.sidebarOpen;
    },
    closeSidebar(state) {
      state.sidebarOpen = false;
    },
    toggleUserMenu(state) {
      state.userMenuOpen = !state.userMenuOpen;
    },
    closeUserMenu(state) {
      state.userMenuOpen = false;
    },
  },
});

export const { toggleSidebar, closeSidebar, toggleUserMenu, closeUserMenu } = uiSlice.actions;
export default uiSlice.reducer;
