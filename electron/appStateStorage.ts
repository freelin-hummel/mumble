import { readFileSync, writeFileSync } from "node:fs";

import {
  migratePersistedAppClientState,
  type PersistedAppClientState
} from "./appClientState.js";

export const loadPersistedAppClientState = (statePath: string) => {
  try {
    return migratePersistedAppClientState(JSON.parse(readFileSync(statePath, "utf8")));
  } catch {
    return null;
  }
};

export const savePersistedAppClientState = (statePath: string, state: PersistedAppClientState) => {
  try {
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
  } catch {
    return;
  }
};
