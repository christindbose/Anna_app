"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AUTH_EVENT, UnauthorizedError, messageOf } from "./api";

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  unauthorized: boolean;
}

/**
 * Fetch-on-mount helper. `key` identifies the request; change it to refetch.
 * Refetches automatically once a password has been saved after a 401.
 */
export function useApi<T>(loader: () => Promise<T>, key: string) {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true, unauthorized: false });

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null, unauthorized: false }));
    loaderRef
      .current()
      .then((data) => {
        if (alive) setState({ data, error: null, loading: false, unauthorized: false });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof UnauthorizedError) {
          setState((s) => ({ ...s, loading: false, unauthorized: true }));
        } else {
          setState((s) => ({ ...s, loading: false, error: messageOf(e) }));
        }
      });
    return () => {
      alive = false;
    };
  }, [tick, key]);

  useEffect(() => {
    window.addEventListener(AUTH_EVENT, reload);
    return () => window.removeEventListener(AUTH_EVENT, reload);
  }, [reload]);

  return { ...state, reload };
}
