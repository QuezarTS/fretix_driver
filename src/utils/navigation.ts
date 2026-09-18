import { type Href, router } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { BackHandler } from 'react-native';

const FROM_ROUTES: Record<string, Href> = {
  home: '/',
  trips: '/trips',
  profile: '/profile',
  activities: '/activities',
  notifications: '/notifications',
};

function normalizeParam(value?: string | string[]): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function buildReturnTo(pathname: string, params?: Record<string, string | number | undefined>): string {
  if (!params) return pathname;

  const query = Object.entries(params)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');

  return query ? `${pathname}?${query}` : pathname;
}

export function parseReturnTo(returnTo: string): Href {
  const [pathname, query] = returnTo.split('?');
  if (!query) return pathname as Href;

  const params: Record<string, string> = {};
  const search = new URLSearchParams(query);
  search.forEach((value, key) => {
    params[key] = value;
  });

  return { pathname, params } as Href;
}

export function goBackSmart(options?: {
  returnTo?: string | string[];
  from?: string | string[];
  fallback?: Href;
}) {
  const returnTo = normalizeParam(options?.returnTo);
  if (returnTo) {
    router.replace(parseReturnTo(returnTo));
    return;
  }

  const from = normalizeParam(options?.from);
  if (from && FROM_ROUTES[from]) {
    router.replace(FROM_ROUTES[from]);
    return;
  }

  const fallback = options?.fallback ?? '/';
  if (router.canGoBack()) {
    router.back();
    return;
  }

  router.replace(fallback);
}

export function useSmartBackHandler(options?: {
  returnTo?: string | string[];
  from?: string | string[];
  fallback?: Href;
}) {
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        goBackSmart(options);
        return true;
      });

      return () => subscription.remove();
    }, [options?.returnTo, options?.from, options?.fallback]),
  );
}

export function pushWithReturnTo(
  pathname: string,
  params: Record<string, string | number | undefined>,
  returnTo: string,
) {
  const normalizedParams = Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value != null && value !== '')
      .map(([key, value]) => [key, String(value)]),
  );

  router.push({
    pathname,
    params: {
      ...normalizedParams,
      returnTo,
    },
  } as Href);
}
