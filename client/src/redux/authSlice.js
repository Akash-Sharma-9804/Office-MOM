import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  fullName: null,
  email: null,
  tokenExpiration: null,
  token: null,
  profileImage: null,
  totalTimes: 0,
  totalRemainingTime: 0,
  totalCreatedMoMs: 0,
};

let logoutTimer;

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setUser: (state, action) => {
      state.fullName = action.payload.fullName;
      state.email = action.payload.email;
      state.token = action.payload.token;
      const expirationTime = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
      state.tokenExpiration = expirationTime;
      state.totalTimes = action.payload.totalTimes;
      state.totalRemainingTime = action.payload.totalRemainingTime;
      state.totalCreatedMoMs = action.payload.totalCreatedMoMs;
      if (logoutTimer) clearTimeout(logoutTimer);
    },

    logout: (state) => {
      state.fullName = null;
      state.email = null;
      state.token = null;
      state.profileImage = null;
      state.tokenExpiration = null;
      state.totalTimes = 0;
      state.totalRemainingTime = 0;
      state.totalCreatedMoMs = 0;
      if (logoutTimer) {
        clearTimeout(logoutTimer);
        logoutTimer = null;
      }
    },

    setProfileImage: (state, action) => {
      state.profileImage = action.payload;
    },

    updateUser: (state, action) => {
      const updates = action.payload;
      Object.keys(updates).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(state, key)) {
          state[key] = updates[key];
        }
      });
    },

    // eslint-disable-next-line no-unused-vars
    setLogoutTimer: (state, action) => {},
  },
});

export const { setUser, logout, setProfileImage, updateUser } =
  authSlice.actions;

export const startLogoutTimer = (timeLeft) => (dispatch) => {
  if (logoutTimer) clearTimeout(logoutTimer);
  logoutTimer = setTimeout(() => {
    dispatch(logout());
  }, timeLeft);
};

export default authSlice.reducer;
