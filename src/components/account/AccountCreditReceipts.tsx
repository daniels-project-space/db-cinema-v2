"use client";
import {useState} from "react";
import {usePaginatedQuery} from "convex/react";
import {api} from "@cvx/_generated/api";
import {formatGbp} from "@/lib/pricing";
export function AccountCreditReceipts({token,accountId}:{token:string;accountId?:string}){
 const {results,status,loadMore}=usePaginatedQuery(api.accountCredits.history,{token,...(accountId?{accountId:accountId as any}:{})},{initialNumItems:20});
 const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState("");
 async function download(id:string){if(busy)return;setBusy(id);setError("");try{const response=await fetch("/api/credits/statement",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({creditId:id})});if(!response.ok||!response.headers.get("content-type")?.startsWith("application/pdf"))throw Error("The credit receipt could not be downloaded.");const url=URL.createObjectURL(await response.blob()),a=document.createElement("a");a.href=url;a.download="DB-Cinema-credit-"+id.slice(-10)+".pdf";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e:any){setError(e.message)}finally{setBusy(null)}}
 if(status==="LoadingFirstPage")return <p role="status" className="text-xs text-white/45">Loading credit receipts…</p>;
 if(!results.length)return null;
 return <section className="mt-5 space-y-3 rounded-2xl border border-emerald-300/15 bg-emerald-300/[.02] p-4" aria-label="Account credit receipts"><h3 className="text-sm font-medium text-white">Account credit receipts</h3>{results.map(row=><article key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3"><div><strong className="text-sm text-emerald-200">{formatGbp(row.amount)}</strong><p className="mt-1 text-xs text-white/55">{row.reason}</p><p className="mt-1 text-[10px] text-white/40">Expires {new Date(row.expiresAt).toLocaleDateString("en-GB",{timeZone:"Europe/London"})} · {row.status}</p></div><button type="button" disabled={!!busy} onClick={()=>void download(row.id)} className="rounded-full border border-white/15 px-3 py-2 text-xs text-white/75 disabled:opacity-40">{busy===row.id?"Downloading…":"Download PDF"}</button></article>)}{status==="CanLoadMore"&&<button type="button" onClick={()=>loadMore(20)} className="text-xs text-emerald-200">Older credit receipts</button>}{error&&<p role="alert" className="text-xs text-red-300">{error}</p>}</section>;
}
