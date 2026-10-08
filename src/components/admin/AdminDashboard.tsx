"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { RentalKit } from "@/components/rentals/RentalKit";
import { rentalDate } from "@/lib/rentalPresentation";
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
      <button onClick={onMessages}><span>Unread messages</span><strong>{unread}</strong><small>Open the rental inbox →</small></button>
      <button onClick={onMessages}><span>Recent alerts</span><strong>{alerts}</strong><small>Review notifications and conversations</small></button>
    </div>
    <div className={styles.tools}>
      <p><i aria-hidden /> DB Cinema Web <span>Live rental records · times in London</span></p>
      <div><button onClick={onCalendar}>Open calendar ↗</button><button onClick={onReports}>Traffic & demand reports ↗</button></div>
    </div>
    <div className={styles.columns}>
      {groups.map(group => <section key={group.key} className={styles.panel} aria-label={group.title}>
        <header><div><h2>{group.title}<span>{group.rows.length}</span></h2><p>{group.description}</p></div><button onClick={onRentals}>View rentals →</button></header>
        {group.rows.length === 0 ? <p className={styles.empty}>{group.empty}</p> : <div className={styles.list}>
          {group.rows.slice(0, 6).map(rental => <article key={rental._id} className={styles.rental}>
            <div className={styles.customer}><div><h3>{rental.customerName || rental.guestEmail}</h3>{rental.customerName && <p>{rental.guestEmail}</p>}</div><span className={rental.overdue || rental.deadlineNeedsReview ? styles.warning : styles.status}>{rental.deadlineNeedsReview ? "Check return time" : rental.overdue ? "Return overdue" : group.key === "active" ? "On hire" : "Confirmed"}</span></div>
            <RentalKit items={rental.kit} compact />
            <div className={styles.period}><span>{rental.start != null && rental.end != null ? rentalDate(rental.start, rental.end) : "Dates need review"}</span><small>{rental.fulfilment === "delivery" ? "Delivery" : "Collection"}{rental.pickupTime ? ` · ${rental.pickupTime}` : " · time to confirm"}{rental.returnTime ? ` · latest return ${rental.returnTime}` : " · return time to confirm"}</small></div>
            <footer><span>DB Cinema Web</span><button onClick={() => onRental(rental._id)}>Manage rental →</button></footer>
          </article>)}
          {group.rows.length > 6 && <button className={styles.more} onClick={onRentals}>View all {group.rows.length} {group.key === "active" ? "active" : "confirmed"} rentals →</button>}
        </div>}
      </section>)}
    </div>
  </section>;
}
