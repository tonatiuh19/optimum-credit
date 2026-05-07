import { configureStore } from "@reduxjs/toolkit";
import clientAuth from "./slices/clientAuthSlice";
import adminAuth from "./slices/adminAuthSlice";
import packages from "./slices/packagesSlice";
import portal from "./slices/portalSlice";
import admin from "./slices/adminSlice";
import reminderFlows from "./slices/reminderFlowsSlice";

export const store = configureStore({
  reducer: {
    clientAuth,
    adminAuth,
    packages,
    portal,
    admin,
    reminderFlows,
  },
  middleware: (getDefault) => getDefault({ serializableCheck: false }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
