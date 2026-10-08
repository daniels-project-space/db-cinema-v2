"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SmartImage } from "@/components/SmartImage";
import { OperationsCalendar } from "./OperationsCalendar";
import { RentalKit } from "@/components/rentals/RentalKit";
import { rentalDate, rentalTitle } from "@/lib/rentalPresentation";
import styles from "./AdminDashboard.module.css";

export function AdminDashboard({ token, unread, alerts, onRental, onRentals, onCalendar, onMessages, onReports }: {
  token: string; unread: number; alerts: number;
  onRental: (id: string) => void; onRentals: () => void; onCalendar: () => void;
  onMessages: () => void; onReports: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const summary = useQuery(api.analytics.adminSummary, { token, now });
  if (!summary) return <section className={styles.loading} aria-busy="true">Loading rental operations…</section>;
  if (!summary.authorized) return <p role="alert" className={styles.loading}>Unlock the admin panel to view rental operations.</p>;
  if (!Array.isArray(summary.awaitingCollection)) return <section className={styles.loading} role="status">The rental overview is temporarily unavailable. <button className={styles.more} onClick={onRentals}>Open Rentals →</button></section>;

  const groups = [
    { key: "active", title: "Current rentals", description: "Collected equipment stays here until its return is recorded.", rows: summary.ongoing, empty: "No equipment is currently marked on hire." },
    { key: "collections", title: "Awaiting handover", description: "Confirmed rentals, ordered by their booked start date.", rows: summary.awaitingCollection, empty: "No confirmed rentals are awaiting collection or delivery." },
  ];
  return <section className={styles.dashboard} aria-label="Rental operations">
    <div className={styles.metrics}>
      <button onClick={onRentals}><span>Active rentals</span><strong>{summary.ongoing.length}</strong><small>{summary.overdueCount ? `${summary.overdueCount} past an agreed return time` : "Recorded as on hire"}</small></button>
      <button onClick={onRentals}><span>Confirmed rentals</span><strong>{summary.awaitingCollection.length}</strong><small>Awaiting collection or delivery</small></button>
      <button onClick={onRentals}><span>Items out</span><strong>{summary.itemsOut ?? "—"}</strong><small>Units across equipment on hire</small></button>
      <button onClick={onMessages}><span>Unread messages</span><strong>{unread}</strong><small>{alerts} recent alerts · open inbox →</small></button>
      <button onClick={onRentals}><span>Overdue returns</span><strong>{summary.overdueCount}</strong><small>Against agreed London return times</small></button>
    </div>
    <div className={styles.tools}>
      <p><i aria-hidden /> DB Cinema Web <span>Live rental records · times in London</span></p>
      <div><button onClick={onCalendar}>Open calendar ↗</button><button onClick={onReports}>Traffic & demand reports ↗</button></div>
    </div>
    <div className={styles.columns}><div className={styles.primary}>
      {groups.map(group => <section key={group.key} className={styles.panel} aria-label={group.title}>
        <header><div><h2>{group.title}<span>{group.rows.length}</span></h2><p>{group.description}</p></div><button onClick={onRentals}>View rentals →</button></header>
        {group.rows.length === 0 ? <p className={styles.empty}>{group.empty}</p> : <div className={styles.list}>
          {group.rows.slice(0, 6).map(rental => <article key={rental._id} className={styles.rental}>
            <div className={styles.rentalSummary}>
              <SmartImage src={rental.kit[0]?.heroImage} fallbackSources={rental.kit[0]?.imageSources} alt={rental.kit[0]?.title ?? "Rental kit"} className={styles.hero}/>
              <div className={styles.kitSummary}><h3 title={rental.kit[0]?.title ?? rental.items}>{rentalTitle(rental.kit[0]?.title ?? rental.items ?? "Rental kit")}</h3><span className={styles.source}>DB Cinema Web</span><p>{rental.start != null && rental.end != null ? rentalDate(rental.start, rental.end) : "Dates need review"}</p><small>{rental.kit.reduce((total,line)=>total+line.qty,0)} {rental.kit.reduce((total,line)=>total+line.qty,0)===1?"unit":"units"} · {rental.kit.length} {rental.kit.length===1?"listing":"listings"}</small></div>
              <div className={styles.customer}><h4>{rental.customerName || rental.guestEmail}</h4><p>{rental.guestEmail}</p><span className={rental.overdue || rental.deadlineNeedsReview ? styles.warning : styles.status}>{rental.deadlineNeedsReview ? "Check return time" : rental.overdue ? "Return overdue" : group.key === "active" ? "On hire" : "Confirmed"}</span></div>
            </div>
            <div className={styles.rentalActions}><details className={styles.kitDetails}><summary>Equipment & handover details <span>+</span></summary><RentalKit items={rental.kit} compact /><p>{rental.fulfilment === "delivery" ? "Delivery" : "Collection"}{rental.pickupTime ? ` · ${rental.pickupTime}` : " · time to confirm"}{rental.returnTime ? ` · latest return ${rental.returnTime}` : " · return time to confirm"}</p></details>
            <footer><span>{rental.fulfilment === "delivery" ? "Delivery" : "Collection"} · {rental.pickupTime ?? "Time to confirm"}</span><button onClick={() => onRental(rental._id)}>Manage rental →</button></footer></div>
          </article>)}
          {group.rows.length > 6 && <button className={styles.more} onClick={onRentals}>View all {group.rows.length} {group.key === "active" ? "active" : "confirmed"} rentals →</button>}
        </div>}
      </section>)}
    </div><aside className={styles.secondary}>
      {[...summary.ongoing,...summary.awaitingCollection].every(row=>Array.isArray(row.calendarLines)) ? <OperationsCalendar rentals={[...summary.ongoing,...summary.awaitingCollection]} onRental={onRental} onCalendar={onCalendar}/> : <section className={styles.panel}><h2>Rental calendar</h2><p className={styles.empty}>The calendar data is temporarily unavailable.</p><button className={styles.more} onClick={onCalendar}>Open calendar →</button></section>}
      <section className={styles.panel}><header><h2>Rental inbox</h2><button onClick={onMessages}>View conversations →</button></header><div className={styles.attentionSummary}><div><strong>{unread}</strong><span>Unread messages</span></div><div><strong>{alerts}</strong><span>Recent alerts</span></div></div><p className={styles.panelNote}>Customer messages and requests stay linked to their rental and account.</p></section>
    </aside></div>
  </section>;
}
