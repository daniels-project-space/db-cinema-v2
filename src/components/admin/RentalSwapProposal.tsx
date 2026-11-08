"use client";

import { useMemo, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";
import { SmartImage } from "@/components/SmartImage";

type ListingImages = { heroImage?: string | null; imageSources?: string[] };
type Replacement = { id: string; title: string } & ListingImages;
type RentalLine = { listingId: string; title: string; qty: number; start?: number; end?: number } & ListingImages;
type StagedChange = { lineIndex: number; replacement: Replacement };
type Review = { snapshot: string; requestId: string; deltaPence: number; creditPence: number; basket: boolean };

function imageList(item?: ListingImages | null) {
  return item?.imageSources?.length ? item.imageSources : item?.heroImage ? [item.heroImage] : [];
}

function ListingPhoto({ title, quantity, images, label }: { title: string; quantity: number; images: string[]; label: string }) {
  return <figure className="min-w-0 flex-1">
    <figcaption className="mb-1 text-[9px] font-medium uppercase tracking-[0.14em] text-white/45">{label}</figcaption>
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/25">
      <SmartImage fit="contain" src={images[0]} fallbackSources={images.slice(1)} alt={`${title} listing photo`} className="h-[66px] w-full object-contain sm:h-[78px]"/>
    </div>
    <p className="mt-1.5 line-clamp-2 min-h-8 break-words text-[10px] font-medium leading-4 text-white/80">{quantity} × {title}</p>
  </figure>;
}

function ChangePair({ current, replacement, quantity }: { current: RentalLine; replacement: Replacement; quantity: number }) {
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_22px_minmax(0,1fr)] items-center gap-2 rounded-2xl border border-white/[0.08] bg-black/20 p-2.5 sm:gap-3 sm:p-3">
    <ListingPhoto title={current.title} quantity={quantity} images={imageList(current)} label="Current"/>
    <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full border border-[#d8ae7a]/20 bg-[#d8ae7a]/[0.08] text-sm text-[#e5bd91]">→</span>
    <ListingPhoto title={replacement.title} quantity={quantity} images={imageList(replacement)} label="New"/>
  </div>;
}

function AmountSummary({ deltaPence }: { deltaPence: number }) {
  const title=deltaPence>0?"Additional payment":deltaPence<0?"Refund to original card":"No card difference";
  const amount=deltaPence===0?formatGbp(0):`${deltaPence>0?"+":"−"}${formatGbp(Math.abs(deltaPence)/100)}`;
  return <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[#d8ae7a]/20 bg-[#d8ae7a]/[0.06] px-3 py-2.5">
    <div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-white/50">Net change</p><p className="mt-0.5 text-[10px] text-white/75">{title}</p></div>
    <strong className="shrink-0 text-lg font-semibold tabular-nums text-[#f3d0a2]">{amount}</strong>
  </div>;
}

export function RentalSwapProposal({token,bookingId,items}:{token:string;bookingId:string;items:RentalLine[]}) {
  const ready=useQuery(api.rentalSwapState.readiness,{token});
  const [open,setOpen]=useState(false),[lineIndex,setLineIndex]=useState(""),[search,setSearch]=useState(""),[replacement,setReplacement]=useState<Replacement|null>(null),[staged,setStaged]=useState<StagedChange[]>([]),[review,setReview]=useState<Review|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const catalog=usePaginatedQuery(api.catalog.adminListListings,ready&&open&&search.trim().length>=2?{token,search:search.trim()}:"skip",{initialNumItems:20});
  const singlePreview=useQuery(api.rentalSwapState.previewForAdmin,ready&&open&&staged.length===0&&lineIndex!==""&&replacement?{token,bookingId:bookingId as any,lineIndex:Number(lineIndex),newListingId:replacement.id as any}:"skip");
  const basketEdits=useMemo(()=>staged.map(change=>({lineIndex:change.lineIndex,newListingId:change.replacement.id as any})),[staged]);
  const basketPreview=useQuery(api.rentalSwapState.previewBasketForAdmin,ready&&open&&staged.length>=2?{token,bookingId:bookingId as any,changes:basketEdits}:"skip");
  const propose=useMutation(api.rentalSwapState.propose),proposeBasket=useMutation(api.rentalSwapState.proposeBasket);
  if(ready===undefined)return null;
  if(!ready)return <section aria-label="Equipment changes unavailable" className="mt-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3 text-sm text-white/70"><p className="font-medium text-white/85">Equipment changes unavailable</p><p className="mt-1 text-xs leading-4 text-white/55">Shared stock coordination is not ready.</p></section>;

  const usedLines=new Set(staged.map(change=>change.lineIndex));
  const addCurrent=()=>{
    if(lineIndex===""||!replacement||usedLines.has(Number(lineIndex)))return;
    setStaged(current=>[...current,{lineIndex:Number(lineIndex),replacement}]);setLineIndex("");setReplacement(null);setReview(null);setMessage("");
  };
  const startReview=(value:any,basket:boolean)=>setReview({snapshot:value.quoteSnapshot,requestId:crypto.randomUUID(),deltaPence:value.quote.deltaPence,creditPence:value.quote.restore.reduce((sum:number,item:any)=>sum+item.amountPence,0),basket});
  const stagedRows=staged.map(change=>({current:items[change.lineIndex],replacement:change.replacement,quantity:items[change.lineIndex]?.qty??1,lineIndex:change.lineIndex}));
  const selectedLine=lineIndex!==""?items[Number(lineIndex)]:undefined;
  const selectedRows=selectedLine&&replacement?[{current:selectedLine,replacement,quantity:selectedLine.qty,lineIndex:Number(lineIndex)}]:[];
  const reviewRows=review?.basket?stagedRows:selectedRows;
  const restoringCredit=(quote:any)=>quote.restore.reduce((sum:number,item:any)=>sum+item.amountPence,0);

  return <details data-testid="admin-equipment-change" className="group mt-3 w-full max-w-[680px] overflow-hidden rounded-[18px] border border-white/[0.1] bg-[linear-gradient(145deg,rgba(52,43,32,.60),rgba(25,26,26,.96)_55%,rgba(18,19,19,.98))] text-sm shadow-[0_14px_35px_rgba(0,0,0,.24)] backdrop-blur-xl" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 marker:hidden sm:p-3.5">
      <span className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-[#d8ae7a]/25 bg-[#d8ae7a]/[0.09] text-base text-[#e5bd91]">↔</span>
        <span className="min-w-0"><span className="block text-[12px] font-semibold text-[#f3e7d8]">Equipment change</span><span className="mt-0.5 block text-[10px] text-white/45">Quote a replacement or combined change</span></span>
      </span>
      <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 text-white/60 transition-transform group-open:rotate-180">⌄</span>
    </summary>
    <div className="border-t border-white/[0.08] p-3 sm:p-3.5">
      {!review&&<p className="mb-3 text-[10px] leading-4 text-white/55">Check the live quote, then send it for renter approval.</p>}

      {staged.length>0&&!review&&<div className="mb-3 rounded-2xl border border-white/[0.08] bg-black/15 p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2"><p className="text-[10px] font-semibold text-[#ead0ae]">Combined change <span className="text-white/45">· {staged.length}</span></p><span className="text-[9px] uppercase tracking-[0.12em] text-white/40">Draft</span></div>
        <div className="grid gap-2">{stagedRows.map(row=>row.current&&<div key={`${row.lineIndex}:${row.replacement.id}`} className="space-y-1.5"><ChangePair current={row.current} replacement={row.replacement} quantity={row.quantity}/><button type="button" disabled={busy} aria-label={`Remove ${row.replacement.title}`} onClick={()=>{setStaged(current=>current.filter(change=>change.lineIndex!==row.lineIndex));setReview(null);}} className="rounded-lg px-2 py-1 text-[10px] text-white/55 underline decoration-white/20 underline-offset-2 hover:text-white/85 disabled:opacity-40">Remove replacement</button></div>)}</div>
        {staged.length<16&&<p className="mt-1 text-[10px] text-white/45">Add another item below to build the combined quote.</p>}
      </div>}

      <label hidden={!!review} className="block text-[10px] font-medium text-white/70">Item to replace
        <select aria-label="Item to replace" value={lineIndex} disabled={busy} onChange={event=>{setLineIndex(event.target.value);setReplacement(null);setReview(null);setMessage("");}} className="input mt-1.5 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-xs text-white">
          <option value="">Select an item</option>{items.map((item,index)=><option key={`${item.listingId}:${index}`} value={index} disabled={usedLines.has(index)}>Item {index+1} · {item.qty} × {item.title}{item.start!=null&&item.end!=null?` · ${new Date(item.start).toLocaleDateString("en-GB",{timeZone:"UTC"})}–${new Date(item.end).toLocaleDateString("en-GB",{timeZone:"UTC"})}`:""}</option>)}
        </select>
      </label>
      <label hidden={!!review} className="mt-3 block text-[10px] font-medium text-white/70">Find replacement
        <input aria-label="Search replacement equipment" value={search} disabled={busy} onChange={event=>{setSearch(event.target.value);setReplacement(null);setReview(null);setMessage("");}} className="input mt-1.5 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-xs text-white placeholder:text-white/35" placeholder="Type at least 2 letters"/>
      </label>

      {open&&search.trim().length>=2&&!review&&<div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto rounded-xl border border-white/[0.08] bg-black/15 p-1.5">
        {catalog.results.filter(item=>!item.displayOnly).map(item=><button data-testid="swap-catalog-result" type="button" key={item._id} disabled={busy} aria-pressed={replacement?.id===item._id} onClick={()=>{setReplacement({id:item._id,title:item.title,heroImage:item.heroImage,imageSources:item.imageSources});setReview(null);setMessage("");}} className={`flex w-full min-w-0 items-center gap-2.5 rounded-xl border p-2 text-left transition ${replacement?.id===item._id?"border-[#d8ae7a]/50 bg-[#d8ae7a]/[0.08]":"border-white/[0.06] bg-white/[0.015] hover:border-white/20"}`}>
          <SmartImage fit="contain" src={imageList(item)[0]} fallbackSources={imageList(item).slice(1)} alt={`${item.title} listing photo`} className="h-10 w-12 shrink-0 rounded-lg border border-white/[0.08] bg-black/25 object-contain"/>
          <span className="min-w-0 flex-1 truncate text-[10px] text-white/80">{item.title}</span><span aria-hidden="true" className="text-xs text-[#e5bd91]">{replacement?.id===item._id?"✓":"＋"}</span>
        </button>)}
        {catalog.status==="CanLoadMore"&&<button type="button" onClick={()=>catalog.loadMore(20)} className="w-full rounded-lg py-2 text-[10px] text-white/65 hover:bg-white/[0.04]">Load more results</button>}
        {catalog.status==="Exhausted"&&catalog.results.filter(item=>!item.displayOnly).length===0&&<p className="p-2 text-[10px] text-white/50">No matching equipment found.</p>}
      </div>}

      {replacement&&lineIndex!==""&&!review&&<div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy||usedLines.has(Number(lineIndex))||staged.length>=16} onClick={addCurrent} className="rounded-xl border border-white/15 bg-white/[0.035] px-3 py-2 text-[10px] font-medium text-white/75 hover:border-white/25 disabled:opacity-40">Add to combined change</button>
        {staged.length===0&&<span className="text-[10px] text-white/40">or review as a single change</span>}
      </div>}

      {staged.length===0&&replacement&&lineIndex!==""&&!review&&<div className="mt-3 rounded-2xl border border-white/[0.08] bg-black/15 p-2.5">
        {singlePreview===undefined?<p className="text-[10px] text-white/55">Checking availability and price…</p>:singlePreview===null?<p className="text-[10px] text-white/55">Unable to load this quote.</p>:!singlePreview.ok?<p role="status" className="text-[10px] leading-4 text-amber-100">{singlePreview.error}</p>:<>
          {selectedLine&&<ChangePair current={selectedLine} replacement={replacement} quantity={singlePreview.oldLine.qty}/>}
          <div className="mt-2.5"><AmountSummary deltaPence={singlePreview.quote.deltaPence}/></div>
          {restoringCredit(singlePreview.quote)>0&&<p className="mt-1.5 text-[10px] text-white/55">Credit restored · {formatGbp(restoringCredit(singlePreview.quote)/100)}</p>}
          <button type="button" disabled={busy} onClick={()=>startReview(singlePreview,false)} className="mt-2.5 min-h-9 w-full rounded-xl border border-[#d8ae7a]/30 bg-[#d8ae7a]/[0.08] px-3 py-2 text-[10px] font-semibold text-[#f0d0a7] hover:bg-[#d8ae7a]/[0.14]">Review single change</button>
        </>}
      </div>}

      {staged.length>=2&&!review&&<div className="mt-3 rounded-2xl border border-white/[0.08] bg-black/15 p-2.5">
        {basketPreview===undefined?<p className="text-[10px] text-white/55">Checking combined availability and price…</p>:basketPreview===null?<p className="text-[10px] text-white/55">Unable to load this combined quote.</p>:!basketPreview.ok?<p role="status" className="text-[10px] leading-4 text-amber-100">{basketPreview.error}</p>:<>
          <AmountSummary deltaPence={basketPreview.quote.deltaPence}/>
          {restoringCredit(basketPreview.quote)>0&&<p className="mt-1.5 text-[10px] text-white/55">Credit restored · {formatGbp(restoringCredit(basketPreview.quote)/100)}</p>}
          <button type="button" disabled={busy} onClick={()=>startReview(basketPreview,true)} className="mt-2.5 min-h-9 w-full rounded-xl border border-[#d8ae7a]/30 bg-[#d8ae7a]/[0.08] px-3 py-2 text-[10px] font-semibold text-[#f0d0a7] hover:bg-[#d8ae7a]/[0.14]">Review combined change</button>
        </>}
      </div>}

      {review&&<div role="region" aria-label="Confirm equipment proposal" data-testid="admin-equipment-change-confirm" className="mt-3 rounded-2xl border border-[#d8ae7a]/25 bg-[linear-gradient(145deg,rgba(48,39,29,.55),rgba(16,17,17,.82))] p-2.5 shadow-[0_10px_30px_rgba(0,0,0,.2)] sm:p-3">
        <div className="flex items-center justify-between gap-2"><div><p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[#d8b28a]/65">Final check</p><h4 className="mt-0.5 text-xs font-semibold text-[#f7ebdc]">Send equipment change?</h4></div><span className="rounded-full border border-[#d8ae7a]/20 bg-[#d8ae7a]/[0.06] px-2 py-1 text-[9px] text-[#ebc89f]">Renter approval</span></div>
        <div className="mt-2.5 grid gap-2">{reviewRows.map(row=>row.current&&<ChangePair key={`${row.lineIndex}:${row.replacement.id}`} current={row.current} replacement={row.replacement} quantity={row.quantity}/>)}</div>
        <div className="mt-2.5"><AmountSummary deltaPence={review.deltaPence}/></div>
        {review.creditPence>0&&<p className="mt-1.5 text-[10px] text-white/55">Credit restored · {formatGbp(review.creditPence/100)}</p>}
        <details className="mt-2.5 rounded-xl border border-white/[0.08] bg-black/15 px-2.5 py-2 text-[10px] text-white/65">
          <summary className="cursor-pointer list-none font-medium text-white/75">Before sending <span aria-hidden="true" className="float-right text-white/40">⌄</span></summary>
          <p className="mt-2 leading-4">The renter must accept. No payment or refund is made by sending this proposal. Rental dates stay the same.</p>
        </details>
        <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          <button type="button" disabled={busy} onClick={()=>setReview(null)} className="min-h-9 rounded-xl border border-white/10 px-3 py-2 text-[10px] text-white/65 hover:bg-white/[0.04] disabled:opacity-40">Back</button>
          <button type="button" disabled={busy} onClick={async()=>{setBusy(true);setMessage("");try{if(review.basket)await proposeBasket({token,bookingId:bookingId as any,changes:basketEdits,requestId:review.requestId,quoteSnapshot:review.snapshot,confirmed:true});else if(replacement&&lineIndex!=="")await propose({token,bookingId:bookingId as any,lineIndex:Number(lineIndex),newListingId:replacement.id as any,requestId:review.requestId,quoteSnapshot:review.snapshot,confirmed:true});setMessage("Equipment proposal sent to the renter's conversation.");setReview(null);setReplacement(null);setStaged([]);setSearch("");setLineIndex("");}catch(error){setMessage(error instanceof Error?error.message:"The proposal could not be sent. Review the quote and try again.");}finally{setBusy(false);}}} className="min-h-9 flex-1 rounded-xl border border-[#e3c39e]/45 bg-[linear-gradient(130deg,#d9b084,#bd8a65)] px-3 py-2 text-[10px] font-semibold text-[#21180f] shadow-[0_7px_16px_rgba(169,119,78,.15)] hover:brightness-110 disabled:opacity-40">{busy?"Sending…":"Confirm and send"}</button>
        </div>
      </div>}
      {message&&<p role="status" className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[10px] leading-4 text-white/75">{message}</p>}
    </div>
  </details>;
}
