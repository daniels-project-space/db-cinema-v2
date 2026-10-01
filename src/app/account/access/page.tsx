"use client";
import { useEffect,useRef,useState } from "react";
import Link from "next/link";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
export default function AccountAccess(){const exchange=useAction(api.accountAccess.exchange),account=useAccount(),started=useRef(false),[error,setError]=useState("");useEffect(()=>{if(started.current)return;started.current=true;const secret=decodeURIComponent(window.location.hash.slice(1));window.history.replaceState(null,'','/account/access');void exchange({secret}).then(r=>{account.acceptSession(r.token);window.location.replace(r.bookingId?`/account?rental=${encodeURIComponent(r.bookingId)}#chat`:'/account');}).catch(e=>setError(e.message??'This link could not be used.'));},[exchange,account]);return <main className="mx-auto max-w-xl px-6 py-24"><h1 className="font-display text-3xl text-white">Your rental workspace</h1><p role="status" className="mt-5 text-sm text-white/60">{error||'Opening your private account…'}</p>{error&&<Link href="/account" className="mt-5 inline-block text-accent-300">Request a new sign-in link →</Link>}</main>;}
