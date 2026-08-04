import { configureStore } from "@reduxjs/toolkit";
import clientAuth from "./slices/clientAuthSlice";
import adminAuth from "./slices/adminAuthSlice";
import packages from "./slices/packagesSlice";
import portal from "./slices/portalSlice";
import admin from "./slices/adminSlice";
import reminderFlows from "./slices/reminderFlowsSlice";
import adminTasks from "./slices/adminTasksSlice";
import reportWizard from "./slices/reportWizardSlice";
import legal from "./slices/legalSlice";
import infoRequests from "./slices/infoRequestsSlice";
import bulkImport from "./slices/bulkImportSlice";
import prospects from "./slices/prospectsSlice";
import creditAnalysis from "./slices/creditAnalysisSlice";
import affiliates from "./slices/affiliatesSlice";
import paySplit from "./slices/paySplitSlice";
import workTasks from "./slices/workTasksSlice";

export const store = configureStore({
  reducer: {
    clientAuth,
    adminAuth,
    packages,
    portal,
    admin,
    reminderFlows,
    adminTasks,
    reportWizard,
    legal,
    infoRequests,
    bulkImport,
    prospects,
    creditAnalysis,
    affiliates,
    paySplit,
    workTasks,
  },
  middleware: (getDefault) => getDefault({ serializableCheck: false }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
