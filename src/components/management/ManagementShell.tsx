"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import styles from "./ManagementShell.module.css";

export type ManagementNav = { key: string; label: string; icon?: string; badge?: number };
const icons: Record<string, string> = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  rentals: "M6 6h12a2 2 0 0 1 2 2v12H4V8a2 2 0 0 1 2-2Z M9 6V3h6v3 M8 12h8 M8 16h5",
  messages: "M4 4h16v13H9l-5 4V4Z M8 8h8 M8 12h5",
  calendar: "M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2",
  inventory: "M3 7h18v14H3z M3 7l3-4h12l3 4 M8 7v14 M16 7v14 M10 12h4",
  reports: "M4 3h16v18H4z M8 16v-4 M12 16V7 M16 16v-6",
  documents: "M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6",
  people: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M3 21v-3a6 6 0 0 1 12 0v3 M17 5a3 3 0 0 1 0 6 M18 15a4 4 0 0 1 3 4v2",
  settings: "M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1 M16 12a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z",
};
export function ManagementShell({ role, title, name, subtitle, nav, active, onNavigate, actions, children, screenOverride, breadcrumb }: { screenOverride?: string; breadcrumb?: ReactNode; role: "renter" | "admin"; title: string; name: string; subtitle?: string; nav: ManagementNav[]; active: string; onNavigate: (key: string) => void; actions?: ReactNode; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const screen = screenOverride ?? (active === "inbox" || active === "chat" ? "messages" : active === "bookings" ? "rentals" : active);
  const secondaryNav = screen === "documents" ? nav.filter(item => ["enquiries","calls","fund","stories"].includes(item.key)) : [];
  const primaryNav = screen === "documents" ? nav.filter(item => !secondaryNav.includes(item)) : nav;
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menuOpen]);
  return <div className={styles.shell} data-management-role={role} data-management-screen={screen}>
    <aside className={`${styles.sidebar} ${menuOpen ? styles.open : ""}`}>
      <button type="button" aria-label="Close account menu" className={styles.closeButton} onClick={() => setMenuOpen(false)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
      <Link href="/" className={styles.brand}><span>DB {screen !== "insights" && <small>CINEMA</small>}</span><b>{screen === "insights" ? "CINEMA RENTALS" : "RENTALS"}</b></Link>
      <nav aria-label={role === "admin" ? "Management navigation" : "Account navigation"} className={styles.nav}>
        {primaryNav.map(item => <button type="button" key={item.key} aria-current={active === item.key ? "page" : undefined} onClick={() => { onNavigate(item.key); setMenuOpen(false); }} className={active === item.key ? styles.selected : ""}>
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={icons[item.key === "marketing" || item.key === "inventory" ? "inventory" : item.key === "reports" ? "reports" : item.icon ?? "rentals"] ?? icons.rentals} /></svg>
          <span>{role === "admin" && /^(inventory|customers)\s*&/i.test(item.label) ? item.label.split(" &")[0] : item.label}</span>{!!item.badge && <b>{item.badge}</b>}
        </button>)}
      </nav>
      {secondaryNav.length>0 && <details className={styles.moreTools}><summary>More tools</summary>{secondaryNav.map(item=><button type="button" key={item.key} onClick={()=>{onNavigate(item.key);setMenuOpen(false);}}>{item.label}</button>)}</details>}
      <div className={styles.sidebarBottom}>
        <div className={styles.sidebarImage} aria-hidden="true"><img src={screen === "documents" ? "/images/management/documents-kit-spotlight.webp" : "/arri-deconstruct-poster.jpg"} alt="" loading="lazy" decoding="async" /></div>
        <p>PROFESSIONAL<br />KIT FOR<br />EXTRAORDINARY<br />STORIES.</p>
        <Link href="/gear" aria-label="Browse equipment">—</Link>
        <p className={styles.locations}>London <i>•</i> Manchester <i>•</i> Bristol</p>
        <span>DB Cinema Rentals<br />Gear people trust.</span>
        {active === "accounts" && actions && <div className={styles.sidebarActions}>{actions}</div>}
      </div>
    </aside>
    <div className={styles.workspace}>
      <header className={styles.topbar}>
        <button type="button" aria-label="Toggle account menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)} className={styles.menuButton}>☰</button>
        {screen === "messages" && <Link href="/" className={styles.chatBrand}><span>DB</span> CINEMA <small>RENTALS</small></Link>}
        {screen === "messages" && <nav className={styles.chatNav} aria-label="Workspace shortcuts">{nav.slice(0, 6).map(item => <button type="button" key={item.key} aria-current={active === item.key ? "page" : undefined} onClick={() => onNavigate(item.key)}>{role === "admin" && /^(inventory|customers)\s*&/i.test(item.label) ? item.label.split(" &")[0] : item.label}</button>)}</nav>}
        <div className={styles.breadcrumb}>{breadcrumb ?? <><span>{role === "admin" ? "Management" : "My account"}</span><i>/</i><strong>{title}</strong></>}</div>
        <div className={styles.actor}><span className={styles.avatar}>{name.slice(0, 1).toUpperCase()}</span><span>{name}<small>{role === "admin" ? "Administrator" : "Renter"}</small></span>{active !== "accounts" && actions}</div>
      </header>
      <main className={styles.content}>
        <div className={styles.heading}><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div></div>
        {children}
      </main>
    </div>
  </div>;
}
