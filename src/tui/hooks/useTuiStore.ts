/**
 * `useTuiStore` — React hook that subscribes to a `TuiController`.
 *
 * Built on `useSyncExternalStore` so React's concurrent renderer remains
 * happy under fast streaming updates.
 */
import { useSyncExternalStore } from "react";

import type { TuiController, TuiState } from "../controller.js";

/**
 * Subscribe to a controller and return the latest TUI state snapshot.
 *
 * Uses `useSyncExternalStore` so React's concurrent renderer remains
 * consistent under fast streaming updates.
 *
 * @param controller - the TUI controller owning chat state.
 * @returns the current {@link TuiState} snapshot.
 */
export function useTuiStore(controller: TuiController): TuiState {
  return useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  );
}
