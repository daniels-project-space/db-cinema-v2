"use client";
import { useState } from "react";
import { useQuery,useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
export function FilmFundAdmin({token}:{token:string}) {
 const info=useQuery(api.filmFund.adminOverview,{token}),saveDates=useMutation(api.filmFund.setRound),setState=useMutation(api.filmFund.setRoundState);
 const [message,setMessage]=useState(""),[selected,setSelected]=useState<string>(),[busyRound,setBusyRound]=useState<string>();
 if(!info)return null;
 async function changeState(slug:string,state:"open"|"closed"|"coming_soon") {
  if(state==="open"&&!window.confirm(`Open this application round and queue an opening email for ${info!.signupCount} consenting signups?`))return;
  setBusyRound(slug);setMessage("");
  try{await setState({token,slug,state,notifySignups:state==="open"});setMessage(state==="open"?"Applications are open. Consenting signups will receive the opening announcement.":state==="closed"?"Round closed. New applications and entry payments are stopped.":"Round is Coming soon.");}catch(e:any){setMessage(e.message);}finally{setBusyRound(undefined);}
 }
 return <section className="rounded-3xl border border-white/10 bg-white/[.02] p-6">
  <p className="text-[10px] uppercase tracking-[.2em] text-white/40">DB Cinema Film Fund</p>
  <div className="mt-4 flex flex-wrap items-baseline gap-3"><span className="font-poster text-5xl text-accent-200">{info.signupCount}</span><h2 className="text-lg text-white">notification signups</h2></div>
  <p className="mt-3 text-sm text-white/50">Save proposed dates, then open a round during its application window. Opening also sends the promised announcement to consenting signups. Coming soon keeps submissions and payments closed.</p>
  <div className="mt-6 grid gap-5 md:grid-cols-2">{info.rounds.map(r=>{
   const open=r.state==="open",canOpen=r.opensAt<=Date.now()&&r.deadline>Date.now();
   return <div key={r.slug} className="min-w-0 rounded-2xl border border-white/10 p-4">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="text-white">{r.name}</h3><span className={`rounded-full px-2 py-1 text-[10px] ${open?'bg-accent-300/10 text-accent-200':'bg-white/5 text-white/50'}`}>{r.state.replace('_',' ')}</span></div>
    <form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusyRound(r.slug);try{await saveDates({token,slug:r.slug,opensAt:Date.parse(String(f.get('opensAt'))+'Z'),deadline:Date.parse(String(f.get('deadline'))+'Z'),announcementAt:Date.parse(String(f.get('announcementAt'))+'Z')});setMessage('Dates saved. Applications remain closed until you open the round.');}catch(e:any){setMessage(e.message);}finally{setBusyRound(undefined);}}}>
     <fieldset disabled={open||!!busyRound}>{([['opensAt','Opening'],['deadline','Deadline'],['announcementAt','Winner announcement']] as const).map(([field,label])=><label key={field} className="mt-3 block text-xs text-white/50">{label} · UTC<input name={field} type="datetime-local" defaultValue={new Date(r[field]).toISOString().slice(0,16)} className="input mt-1 w-full min-w-0"/></label>)}<button className="btn-ghost mt-4 px-4 py-2 text-xs disabled:opacity-40">Save dates</button></fieldset>
    </form>
    <div className="mt-4 flex flex-wrap gap-2">{open?<button disabled={!!busyRound} onClick={()=>void changeState(r.slug,'closed')} className="btn-ghost px-4 py-2 text-xs">Close round</button>:<><button disabled={!canOpen||!!busyRound} onClick={()=>void changeState(r.slug,'open')} className="btn-primary px-4 py-2 text-xs disabled:opacity-30">Open round & notify signups</button>{r.state==='closed'&&<button disabled={!!busyRound} onClick={()=>void changeState(r.slug,'coming_soon')} className="btn-ghost px-4 py-2 text-xs">Mark Coming soon</button>}</>}</div>
    {!open&&!canOpen&&<p className="mt-2 text-[11px] text-white/40">Opening is available only between the opening time and deadline.</p>}
   </div>;
  })}</div>
  <p role="status" className="mt-4 text-xs text-accent-200">{message}</p>
  <h3 className="mt-8 text-lg text-white">Submitted projects · {info.projects.length}</h3>{!info.projects.length&&<p className="mt-2 text-sm text-white/40">No submitted applications. Private drafts are excluded.</p>}
  {info.projects.map(p=><div key={p._id} className="mt-3 rounded-xl border border-white/10 p-4"><h4 className="text-white">{p.title}</h4><p className="mt-1 text-xs text-white/50">{p.roundSlug} · {p.reviewStatus} · {p.entryIncluded?'Included membership entry':p.entryPaid?'Paid single project entry':'Entry refunded · ineligible'}</p><p className="mt-2 text-sm text-white/50">{p.synopsis}</p><button onClick={()=>setSelected(selected===p._id?undefined:p._id)} className="mt-3 text-xs text-accent-300">{selected===p._id?"Close review":"Open application and files →"}</button>{selected===p._id&&<ApplicationReview token={token} projectId={p._id}/>}</div>)}
 </section>;
}

function ApplicationReview({token,projectId}:{token:string;projectId:string}){
 const data=useQuery(api.filmFund.adminApplication,{token,projectId:projectId as any}),review=useMutation(api.filmFund.reviewApplication),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 if(!data)return <p className="mt-4 text-xs text-white/40">Loading private application…</p>;
 return <div className="mt-5 space-y-5 border-t border-white/10 pt-5">
 <p className="text-xs text-white/50">Applicant: {data.applicantEmail} · {data.project.tags.join(" · ")}</p>
 <div><h5 className="text-sm text-white">Creative letter</h5><p className="mt-2 whitespace-pre-wrap text-sm text-white/60">{data.project.letter}</p></div>
 <div><h5 className="text-sm text-white">Crew</h5>{data.project.crew.map((c,i)=><div key={i} className="mt-3 rounded-xl bg-white/[.03] p-3"><a href={c.profile} target="_blank" rel="noopener noreferrer" className="text-sm text-accent-200">{c.name} · {c.role} ↗</a><p className="mt-1 text-xs text-white/50">{c.bio}</p></div>)}</div>
 <div className="flex flex-wrap gap-2">{data.files.map(f=><a key={f.id} href={f.url??undefined} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-white/10 px-3 py-2 text-xs text-accent-200">{f.kind}: {f.name}{f.durationSeconds?` · ${Math.round(f.durationSeconds)}s`:""} ↗</a>)}</div>
 <form onSubmit={async e=>{e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true);setMessage("");try{await review({token,projectId:projectId as any,status:String(form.get('status')) as any,note:String(form.get('note'))});setMessage('Review saved. No applicant notification has been sent.');}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}} className="space-y-3">
 <label className="block text-xs text-white/50">Decision<select name="status" defaultValue={data.project.reviewStatus??"new"} className="input mt-1 w-full">{[['new','New'],['shortlisted','Shortlisted'],['winner','Winner · 7 days of gear'],['runner_up','Runner-up · 2 days of gear'],['not_selected','Not selected']].map(([value,label])=><option key={value} value={value} disabled={!data.project.entryIncluded&&!data.project.entryPaid&&["shortlisted","winner","runner_up"].includes(value)}>{label}</option>)}</select></label>
 <label className="block text-xs text-white/50">Private review note<textarea name="note" defaultValue={data.project.reviewNote??""} maxLength={4000} rows={3} className="input mt-1 w-full"/></label>
 <button disabled={busy} className="btn-ghost px-4 py-2 text-xs">{busy?'Saving…':'Save review'}</button><p role="status" className="text-xs text-accent-200">{message}</p>
 </form></div>;
}
