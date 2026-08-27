import * as AblyLib from "ably";
import api from "@/lib/api";

/**
 * Shared Ably Realtime client singleton (real-state pattern).
 * One websocket per browser tab — avoids duplicate connections and Ably quota churn.
 */

let clientPromise: Promise<AblyLib.Realtime | null> | null = null;
let currentToken: string | null = null;
/** After 503 / invalid key, skip token probes for this tab session (no retry spam). */
let ablyPermanentlyUnavailable = false;

export function isAblyPermanentlyUnavailable(): boolean {
  return ablyPermanentlyUnavailable;
}

async function fetchToken(): Promise<AblyLib.TokenRequest> {
  if (ablyPermanentlyUnavailable) {
    throw new Error("ably_not_configured");
  }
  try {
    const { data } = await api.get("/admin/me/ably-token");
    if (!data?.tokenRequest) {
      ablyPermanentlyUnavailable = true;
      throw new Error("ably_not_configured");
    }
    return data.tokenRequest as AblyLib.TokenRequest;
  } catch (err: unknown) {
    const ax = err as {
      response?: { status?: number; data?: { error?: string } };
    };
    if (
      ax.response?.status === 503 ||
      ax.response?.data?.error === "ably_not_configured"
    ) {
      ablyPermanentlyUnavailable = true;
    }
    throw err;
  }
}

export function getSharedAblyClient(
  sessionToken: string | null,
): Promise<AblyLib.Realtime | null> {
  if (!sessionToken || ablyPermanentlyUnavailable) {
    return Promise.resolve(null);
  }

  if (currentToken && currentToken !== sessionToken) {
    closeSharedAblyClient();
  }

  if (!clientPromise) {
    currentToken = sessionToken;
    clientPromise = (async () => {
      try {
        const initial = await fetchToken();
        let firstUse = true;
        return new AblyLib.Realtime({
          authCallback: async (_tokenParams, cb) => {
            try {
              if (firstUse) {
                firstUse = false;
                cb(null, initial);
                return;
              }
              const fresh = await fetchToken();
              cb(null, fresh);
            } catch (err) {
              cb(err as AblyLib.ErrorInfo, null);
            }
          },
        });
      } catch {
        ablyPermanentlyUnavailable = true;
        clientPromise = null;
        currentToken = null;
        return null;
      }
    })();
  }
  return clientPromise;
}

export function closeSharedAblyClient() {
  if (clientPromise) {
    clientPromise
      .then((c) => {
        try {
          c?.close();
        } catch {
          /* noop */
        }
      })
      .catch(() => {});
  }
  clientPromise = null;
  currentToken = null;
  ablyPermanentlyUnavailable = false;
}
