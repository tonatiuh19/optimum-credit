import { useEffect, useRef } from "react";

/**
 * Ids of messages that arrived after a thread was opened (so only they animate in).
 * Everything present on the first loaded render of a thread counts as history.
 */
export function useNewMessageIds(threadKey: string | null, ids: Array<string | number>, loading: boolean): Set<string> {
  const seen = useRef<{ key: string | null; ids: Set<string> | null }>({ key: null, ids: null });
  const fresh = new Set<string>();

  if (seen.current.key !== threadKey) seen.current = { key: threadKey, ids: null };
  if (!loading) {
    if (seen.current.ids === null) {
      if (ids.length > 0) seen.current.ids = new Set(ids.map(String));
    } else {
      for (const id of ids) if (!seen.current.ids.has(String(id))) fresh.add(String(id));
    }
  }

  // Commit after render so a re-render does not replay the entry animation.
  useEffect(() => {
    if (seen.current.ids) for (const id of fresh) seen.current.ids.add(id);
  });

  return fresh;
}
