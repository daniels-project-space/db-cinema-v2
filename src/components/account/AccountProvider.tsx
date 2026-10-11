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
import { LoyaltyCelebration } from "./LoyaltyCelebration";

type Me = {
  _id: string;
  email: string;
  name: string | null;
  phone: string | null;
  address: string | null;
  marketingEmails: boolean;
  favorites: string[];
  avatarUrl: string | null;
  idVerified: boolean;
  hasPassword: boolean;
  storeCredit: number;
  earnedCredit:number;refundCredit:number;referralCode:string|null;
  loyaltyLevel:number;loyaltyPercent:number;loyaltyCelebratedLevel:number;
  membershipTier: string | null;
  membershipActive: boolean;
  membershipAdminGranted?: boolean;
  membershipBillingTier?: string | null;
  membershipPerksPending: boolean;
  loyaltyEligible: boolean;
  loyaltyCompleted: number;
  loyaltyCelebrated: boolean;
  membershipStatus: string | null;
  membershipPaidThrough: number | null;
  membershipTrialEnd: number | null;
  membershipCancelAtPeriodEnd: boolean;
  membershipIntroUsed: boolean;
  freeAccessoryMonth: string | null;
  freeAccessoryUsed: number;
} | null;

type AccountCtx = {
  token: string | null;
  me: Me;
  loading: boolean;
  signUp: (email: string, password: string, name?: string, basketReminderDisabled?: boolean) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (credential: string, basketReminderDisabled?: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  acceptSession: (token: string) => void;
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
  const ensureReferral = useMutation(api.referrals.ensureMine);
  useEffect(()=>{if(token&&meRes?.email&&!meRes.referralCode)void ensureReferral({token}).catch(()=>{});},[token,meRes?.email,meRes?.referralCode,ensureReferral]);
  const acknowledgeLoyalty = useMutation(api.accounts.acknowledgeLoyalty);
  const claimFollowUpsM = useMutation(api.followUp.claimForAccount);
  useEffect(() => {
    // Email-link account creation completes after signup has returned. Claim
    // the renter's earlier Gaffer history only once ownership is authenticated.
    if (token && meRes?.email)
      void claimFollowUpsM({ token, email: meRes.email }).catch(() => {});
  }, [token, meRes?.email, claimFollowUpsM]);

  const persist = (t: string | null) => {
    setToken(t);
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  };

  const signUp = useCallback(
    async (email: string, password: string, name?: string, basketReminderDisabled = false) => {
      const { token } = await signUpA({ email, password, name, basketReminderDisabled });
      if(!token)return;
      persist(token);
      // Someone who took a Gaffer call, got an email follow-up and only then
      // signed up is the same person — attach that history to the new account so
      // their chat continues the conversation rather than starting a blank one.
      try {
        await claimFollowUpsM({ token, email });
      } catch {
        /* continuity is a bonus, never a reason to fail a signup */
      }
    },
    [signUpA, claimFollowUpsM],
  );
  const signIn = useCallback(
    async (email: string, password: string) => {
      const { token } = await signInA({ email, password });
      persist(token);
    },
    [signInA],
  );
  const signInWithGoogle = useCallback(
    async (credential: string, basketReminderDisabled = false) => {
      const { token } = await signInGoogleA({ credential, basketReminderDisabled });
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
        acceptSession: persist,
        updateProfile,
        toggleFavorite,
      }}
    >
      {children}
      {token && meRes?.loyaltyEligible && !meRes.loyaltyCelebrated && <LoyaltyCelebration level={meRes.loyaltyLevel} subscriptionActive={meRes.membershipActive} onAcknowledge={()=>acknowledgeLoyalty({token,level:meRes.loyaltyLevel})}/> }
    </Ctx.Provider>
  );
}

export function useAccount() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAccount must be used within AccountProvider");
  return c;
}
