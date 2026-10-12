"use client";
import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import type {Guide} from "@/lib/guides";
import {guideReadMinutes,selectGuides} from "@/lib/guideLibrary";
import {IconArrowRight} from "@/components/icons";
import styles from "./GuideLibrary.module.css";

const defaults={query:"",topic:"",format:"all",sort:"recommended"};
export function GuideLibrary({guides,topics}:{guides:Guide[];topics:readonly string[]}) {
  const [filters,setFilters]=useState(defaults),[limit,setLimit]=useState(8);
  const [enhanced,setEnhanced]=useState(false);
  const categories=useMemo(()=>[...new Set([...topics,...guides.map(g=>g.category)])],[topics,guides]);
  useEffect(()=>{
    const restore=()=>{const p=new URLSearchParams(window.location.search);setFilters({query:p.get("q")??"",topic:categories.includes(p.get("topic")??"")?p.get("topic")!:"",format:["video","text"].includes(p.get("format")??"")?p.get("format")!:"all",sort:["az","short"].includes(p.get("sort")??"")?p.get("sort")!:"recommended"});setLimit(8)};
    restore();setEnhanced(true);window.addEventListener("popstate",restore);return()=>window.removeEventListener("popstate",restore);
  },[categories]);
  const results=useMemo(()=>selectGuides(guides,filters),[guides,filters]);
  function update(patch:Partial<typeof defaults>) {
    const next={...filters,...patch};setFilters(next);setLimit(8);
    const url=new URL(window.location.href);
    for(const [key,value] of Object.entries(next)){const param=key==="query"?"q":key;if(value&&value!==defaults[key as keyof typeof defaults])url.searchParams.set(param,value);else url.searchParams.delete(param)}
    window.history.replaceState(window.history.state,"",url);
  }
  const filtered=Object.keys(defaults).some(key=>filters[key as keyof typeof defaults]!==defaults[key as keyof typeof defaults]);
  return <section aria-label="Guide library" className={styles.library}>
    <header className={styles.header}><div><span className="hud-label">THE KNOWLEDGE LIBRARY</span><h2>Find the right guide</h2><p>Choose your kit, solve a setup problem or learn a new technique.</p></div><span className={styles.count}>{guides.length} practical guides</span></header>
    <div className={styles.controls}>
      <label className={styles.search}>Search guides<input type="search" value={filters.query} onChange={e=>update({query:e.target.value})} placeholder="Try gimbal, lighting or S-Log3…" /></label>
      <label>Format<select value={filters.format} onChange={e=>update({format:e.target.value})}><option value="all">All guides</option><option value="video">Includes a video</option><option value="text">Reading only</option></select></label>
      <label>Sort by<select value={filters.sort} onChange={e=>update({sort:e.target.value})}><option value="recommended">Recommended</option><option value="az">Title: A–Z</option><option value="short">Shortest read</option></select></label>
    </div>
    <div className={styles.topics} role="group" aria-label="Filter guides by topic">
      {["",...categories].map(topic=><button key={topic} type="button" aria-pressed={filters.topic===topic} onClick={()=>update({topic})}>{topic||"All topics"}<span>{topic?guides.filter(g=>g.category===topic).length:guides.length}</span></button>)}
    </div>
    <div className={styles.results}><p role="status">{results.length} {results.length===1?"guide":"guides"}{filters.query?` matching “${filters.query}”`:""}</p>{filtered&&<button type="button" onClick={()=>update(defaults)}>Clear filters</button>}</div>
    {results.length?<div className={styles.grid}>{results.slice(0,enhanced?limit:results.length).map(guide=><Link key={guide.slug} href={`/guides/${guide.slug}`} className={styles.card}>
      <div className={styles.meta}><span>{guide.category}</span><span>{guideReadMinutes(guide)} min read{guide.sections.some(s=>s.video)&&" · Video included"}</span></div>
      <h3>{guide.title}</h3><p>{guide.description}</p><span className={styles.read}>Read guide <IconArrowRight className="h-4 w-4" /></span>
    </Link>)}</div>:<div className={styles.empty}><h3>No guides match those filters</h3><p>Try a broader phrase, another topic or clear your filters.</p><button type="button" onClick={()=>update(defaults)}>Show all guides</button></div>}
    {enhanced&&results.length>limit&&<button type="button" className={styles.more} onClick={()=>setLimit(value=>value+8)}>Show more guides <span>{results.length-limit} remaining</span></button>}
  </section>;
}
