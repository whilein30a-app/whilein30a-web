import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { useAuth } from './auth';
import { supabase } from './supabase';

export type MyListing = {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  description: string | null;
  is_sponsored: boolean | null;
  subcategory: string | null;
  plan: 'basic' | 'premium' | 'featured' | 'spotlight';
  billing: 'month' | 'year' | null;
  is_founding: boolean | null;
  plan_expires_on: string | null;
  logo_url: string | null;
  menu_url: string | null;
  booking_url: string | null;
};

type State = {
  listings: MyListing[];
  current: MyListing | null;
  select: (id: string) => void;
  reload: () => Promise<void>;
  loading: boolean;
};

const Ctx = createContext<State>({ listings: [], current: null, select: () => {}, reload: async () => {}, loading: true });
export const useListings = () => useContext(Ctx);

const KEY = 'portal_listing';

export function ListingProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [listings, setListings] = useState<MyListing[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!session) {
      setListings([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase.rpc('portal_my_listings');
    const rows = (data ?? []) as MyListing[];
    setListings(rows);
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      // Storage can be unavailable. Fall back to the first listing.
    }
    setCurrentId((prev) => {
      const wanted = prev ?? saved;
      return rows.some((r) => r.id === wanted) ? wanted : rows[0]?.id ?? null;
    });
    setLoading(false);
  }, [session]);

  useEffect(() => {
    reload();
  }, [reload]);

  const select = (id: string) => {
    setCurrentId(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // Not essential.
    }
  };

  return (
    <Ctx.Provider value={{ listings, current: listings.find((l) => l.id === currentId) ?? null, select, reload, loading }}>
      {children}
    </Ctx.Provider>
  );
}
