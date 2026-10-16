import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";
import "@/i18n";

/**
 * Radix FocusScope (Dialog) schedules setTimeout(0) on unmount to restore
 * focus via CustomEvent. Under full-suite jsdom load that dispatch can throw:
 *   TypeError: Failed to execute 'dispatchEvent' … not of type 'Event'
 * as an *unhandled* exception after tests pass — aborting deploy:prod.
 * Soft-skip invalid/cross-realm events so teardown cannot fail the run.
 */
beforeAll(() => {
  const original = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (
    this: EventTarget,
    event: Event,
  ): boolean {
    try {
      return original.call(this, event);
    } catch (err) {
      if (
        err instanceof TypeError &&
        /dispatchEvent|not of type ['"]?Event['"]?/i.test(String(err.message))
      ) {
        return true;
      }
      throw err;
    }
  };
});

afterEach(async () => {
  cleanup();
  // Let FocusScope unmount autofocus timeouts run while jsdom is still alive.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
});
