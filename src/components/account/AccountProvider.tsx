"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";

type Me = {
  _id: string;
  email: string;
  name: string | null;
  phone: string | null;
  address: string | null;
  marketingEmails: boolean;
  favorites: string[];
  idVerified: boolean;
  membershipTier: string | null;
  membershipActive: boolean;
  freeAccessoryMonth: string | null;
  freeAccessoryUsed: number;
} | null;

type AccountCtx = {
  token: string | null;
  me: Me;
  loading: boolean;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (credential: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (patch: {
    name?: string;
    phone?: string;
    address?: string;
    marketingEmails?: boolean;
  }) => Promise<void>;
  toggleFavorite: (listingId: string) => Promise<void>;
};

const Ctx = createContext<AccountCtx | null>(null);
const KEY = "dbc_acct";

export function AccountProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setToken(localStorage.getItem(KEY));
    setHydrated(true);
  }, []);

  const meRes = useQuery(api.accounts.me, token ? { token } : "skip");
  const signUpA = useAction(api.accounts.signUp);
  const signInA = useAction(api.accounts.signIn);
  const signInGoogleA = useAction(api.googleAuth.signInWithGoogle);
  const signOutM = useMutation(api.accounts.signOut);
  const updateM = useMutation(api.accounts.updateProfile);
  const favM = useMutation(api.accounts.toggleFavorite);

  const persist = (t: string | null) => {
    setToken(t);
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  };

  const signUp = useCallback(
    async (email: string, password: string, name?: string) => {
      const { token } = await signUpA({ email, password, name });
      persist(token);
    },
    [signUpA],
  );
  const signIn = useCallback(
    async (email: string, password: string) => {
      const { token } = await signInA({ email, password });
      persist(token);
    },
    [signInA],
  );
  const signInWithGoogle = useCallback(
    async (credential: string) => {
      const { token } = await signInGoogleA({ credential });
      persist(token);
    },
    [signInGoogleA],
  );
  const signOut = useCallback(async () => {
    if (token) await signOutM({ token });
    persist(null);
  }, [token, signOutM]);
  const updateProfile = useCallback(
    async (patch: any) => {
      if (token) await updateM({ token, ...patch });
    },
    [token, updateM],
  );
  const toggleFavorite = useCallback(
    async (listingId: string) => {
      if (token) await favM({ token, listingId });
    },
    [token, favM],
  );

  // invalid token (me === null) → clear it
  useEffect(() => {
    if (token && meRes === null) persist(null);
  }, [token, meRes]);

  return (
    <Ctx.Provider
      value={{
        token,
        me: (meRes ?? null) as Me,
        loading: !hydrated || (!!token && meRes === undefined),
        signUp,
        signIn,
        signInWithGoogle,
        signOut,
        updateProfile,
        toggleFavorite,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAccount() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAccount must be used within AccountProvider");
  return c;
}
