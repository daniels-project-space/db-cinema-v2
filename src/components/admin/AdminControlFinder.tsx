"use client";
import { useEffect, useState } from "react";
import { type AccountControl, findAccountControls } from "./accountControlSearch";
import styles from "./AccountAdmin.module.css";

export function AccountControlSearch({contextKey, notice, onSelect}: {contextKey:string; notice:string; onSelect:(control:AccountControl)=>void}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {setQuery(""); setOpen(false);}, [contextKey]);
  const results = findAccountControls(query);
  return <div className={styles.controlSearch} onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);}}>
    <label className={styles.controlSearchInput}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></svg>
      <span className={styles.srOnly}>Find an admin control</span>
      <input data-testid="admin-control-search" type="search" maxLength={100} placeholder="Find a rental or account control…" value={query} onChange={event => {setQuery(event.target.value); setOpen(true);}} onFocus={() => setOpen(true)} onKeyDown={event => {if (event.key === "Escape") setOpen(false);}} aria-expanded={open} aria-controls="admin-control-results" autoComplete="off" />
    </label>
    {open && <div id="admin-control-results" className={styles.controlResults} aria-label="Matching admin controls">
      {results.slice(0, 8).map(control => <button type="button" key={control.id} data-testid={`admin-control-${control.id}`} onClick={() => {onSelect(control); setOpen(false);}}><span><strong>{control.label}</strong><small>{control.description}</small></span><span aria-hidden="true">↗</span></button>)}
      {!results.length && <p>No matching controls. Try another word.</p>}
    </div>}
    {notice && <p role="status" className={styles.controlNotice}>{notice}</p>}
  </div>;
}
