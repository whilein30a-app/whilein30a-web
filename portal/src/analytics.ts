import { firebaseConfig } from './firebase-config';

// Google Analytics through Firebase. Loaded after the page is up so it never
// slows the portal, and skipped until the real config is pasted in.
// Only page views and simple events; no names, emails or business details.
export function startAnalytics() {
  const c = firebaseConfig;
  if (!c.apiKey || c.apiKey.startsWith('PASTE') || !/^G-[A-Z0-9]+$/.test(c.measurementId)) return;
  if (navigator.doNotTrack === '1') return;
  void (async () => {
    try {
      const [{ initializeApp }, { getAnalytics, isSupported }] = await Promise.all([
        import('firebase/app'),
        import('firebase/analytics'),
      ]);
      if (!(await isSupported())) return;
      getAnalytics(initializeApp(c));
    } catch {
      // Analytics must never break the portal.
    }
  })();
}
