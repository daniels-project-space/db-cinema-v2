"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAction, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { accountAccessDestination, accountAccessError } from "../../../../shared/accountAccess";
import { useAccount } from "@/components/account/AccountProvider";

export default function AccountAccess() {
  const exchange = useAction(api.accountAccess.exchange), account = useAccount();
  const requestClaim=useMutation(api.encoreGuestClaims.request);
  const handled = useRef<string | null>(null), mounted = useRef(false);
  const accept = useRef(account.acceptSession);
  accept.current = account.acceptSession;
  const [error, setError] = useState("");
  const [claimId,setClaimId]=useState(""),[email,setEmail]=useState(""),[requested,setRequested]=useState(false),[requestError,setRequestError]=useState("");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const openLink = () => {
      const fragment = window.location.hash.slice(1);
      if ((!fragment && handled.current !== null) || fragment === handled.current) return;
      handled.current = fragment;
      const next = new URLSearchParams(window.location.search).get("next");
      setClaimId(new URLSearchParams(window.location.search).get("claim")??"");
      window.history.replaceState(null, "", "/account/access");
      setError("");
      let secret: string;
      try { secret = decodeURIComponent(fragment); }
      catch { setError(accountAccessError({ data: { code: "ACCESS_LINK_INVALID" } })); return; }
      void exchange({ secret }).then(result => {
        if (!mounted.current || handled.current !== fragment) return;
        accept.current(result.token);
        window.location.replace(accountAccessDestination(result.bookingId, next));
      }).catch(error => {
        if (mounted.current && handled.current === fragment) setError(accountAccessError(error));
      });
    };
    openLink();
    window.addEventListener("hashchange", openLink);
    return () => window.removeEventListener("hashchange", openLink);
  }, [exchange]);
  return <main className="mx-auto max-w-xl px-6 py-24">
    <h1 className="font-display text-3xl text-white">Your rental workspace</h1>
    <p role="status" className="mt-5 text-sm text-white/60">{error || "Opening your private account…"}</p>
    {error && <Link href="/account" className="mt-5 inline-block text-accent-300">Request a new sign-in link →</Link>}
    {error && claimId && <form className="mt-6 space-y-3" onSubmit={event=>{event.preventDefault();setRequestError("");void requestClaim({bookingId:claimId as any,email}).then(()=>setRequested(true)).catch(()=>setRequestError("Could not request a new link. Please try again or contact the team."));}}><label className="block text-sm text-white/60">Rental email<input type="email" required maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} className="input mt-2 w-full" /></label><button className="btn-primary" type="submit">Request a new rental confirmation link</button>{requested&&<p role="status" className="text-sm text-white/60">If this rental can be claimed, a new private link will be emailed to its booking address.</p>}{requestError&&<p role="alert" className="text-sm text-red-300">{requestError}</p>}</form>}
  </main>;
}
