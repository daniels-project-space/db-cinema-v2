"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SmartImage } from "@/components/SmartImage";
import { OperationsCalendar } from "./OperationsCalendar";
import { RentalKit } from "@/components/rentals/RentalKit";
import { rentalDate, rentalTitle } from "@/lib/rentalPresentation";
import styles from "./AdminDashboard.module.css";
import { formatGbp } from "@/lib/pricing";
import { DASHBOARD_PREVIEW_COUNT, dashboardVerificationPending } from "../../../shared/dashboardPreviews";

export function AdminDashboard({ token, unread, alerts, onRental, onRentals, onCalendar, onMessages, onReports, onInventory }: {
  token: string; unread: number; alerts: number;
  onRental: (id: string) => void; onRentals: () => void; onCalendar: () => void;
  onMessages: () => void; onReports: () => void;
  onInventory?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const summary = useQuery(api.analytics.adminSummary, { token, now });
  const panels = useQuery(api.analytics.dashboardPanels, { token, now });
  if (!summary) return <section className={styles.loading} aria-busy="true">Loading rental operations…</section>;
  if (!summary.authorized) return <p role="alert" className={styles.loading}>Unlock the admin panel to view rental operations.</p>;
  if (!Array.isArray(summary.awaitingCollection)) return <section className={styles.loading} role="status">The rental overview is temporarily unavailable. <button className={styles.more} onClick={onRentals}>Open Rentals →</button></section>;

  const pendingVerification = summary.awaitingCollection.filter(dashboardVerificationPending);
  const groups = [
    { key: "active", title: "Current rentals", description: "Collected equipment stays here until its return is recorded.", rows: summary.ongoing, empty: "No equipment is currently marked on hire." },
    { key: "verification", title: "Pending verification", description: "Confirmed rentals needing identity, address or drone document review.", rows: pendingVerification, empty: "No confirmed rentals are awaiting document verification." },
  ];
  return <section className={styles.dashboard} aria-label="Rental operations">
    <div className={styles.metrics}>
      <button onClick={onRentals}><span>Active rentals</span><strong>{summary.ongoing.length}</strong><small>{summary.overdueCount ? `${summary.overdueCount} past an agreed return time` : "Recorded as on hire"}</small></button>
      <button onClick={onRentals}><span>Confirmed rentals</span><strong>{summary.awaitingCollection.length}</strong><small>Awaiting collection or delivery</small></button>
      <button onClick={onRentals}><span>Items out</span><strong>{summary.itemsOut ?? "—"}</strong><small>Units across equipment on hire</small></button>
      <button onClick={onRentals}><span>Pending verification</span><strong>{pendingVerification.length}</strong><small>Required booking document checks</small></button>
      <button onClick={onRentals}><span>Overdue returns</span><strong>{summary.overdueCount}</strong><small>Against agreed London return times</small></button>
    </div>
    <div className={styles.columns}><div className={styles.primary}>
      {groups.map(group => <section key={group.key} className={styles.panel} aria-label={group.title}>
        <header><div><h2>{group.title}<span>{group.rows.length}</span></h2><p>{group.description}</p></div><button onClick={onRentals}>View rentals →</button></header>
        {group.rows.length === 0 ? <p className={styles.empty}>{group.empty}</p> : <div className={styles.list}>
          {group.rows.slice(0, DASHBOARD_PREVIEW_COUNT).map(rental => <article key={rental._id} className={styles.rental}>
            <div className={styles.rentalSummary}>
              <SmartImage src={rental.kit[0]?.heroImage} fallbackSources={rental.kit[0]?.imageSources} alt={rental.kit[0]?.title ?? "Rental kit"} className={styles.hero} imgClassName={styles.heroImage}/>
              <div className={styles.kitSummary}><h3 title={rental.kit[0]?.title ?? rental.items}>{rentalTitle(rental.kit[0]?.title ?? rental.items ?? "Rental kit")}</h3><span className={styles.source}>DB Cinema Web</span><p>{rental.start != null && rental.end != null ? rentalDate(rental.start, rental.end) : "Dates need review"}</p><small>{rental.kit.reduce((total,line)=>total+line.qty,0)} {rental.kit.reduce((total,line)=>total+line.qty,0)===1?"unit":"units"} · {rental.kit.length} {rental.kit.length===1?"listing":"listings"}</small></div>
              <div className={styles.customer}><div className={styles.customerIdentity}><span className={styles.avatar} aria-hidden="true">{rental.customerPhoto ? <SmartImage src={rental.customerPhoto} alt="" className={styles.avatarPhoto}/> : (rental.accountNeedsReview ? "?" : (rental.customerName || rental.guestEmail || "Customer").split(/\s+/).slice(0,2).map(part=>part[0]).join("").toUpperCase())}</span><div><h4>{rental.customerName || rental.guestEmail}</h4><p className={rental.accountNeedsReview ? styles.accountReview : undefined}>{rental.accountNeedsReview ? "Account needs review" : rental.guestEmail}</p></div></div><span className={rental.overdue || rental.deadlineNeedsReview ? styles.warning : styles.status}>{rental.deadlineNeedsReview ? "Check return time" : rental.overdue ? "Return overdue" : group.key === "active" ? "On hire" : "Needs verification"}</span></div>
            </div>
            <div className={styles.rentalActions}><details className={styles.kitDetails}><summary>Equipment & handover details <span>+</span></summary><RentalKit items={rental.kit} compact /><p>{rental.fulfilment === "delivery" ? "Delivery" : "Collection"}{rental.pickupTime ? ` · ${rental.pickupTime}` : " · time to confirm"}{rental.returnTime ? ` · latest return ${rental.returnTime}` : " · return time to confirm"}</p></details>
            <footer><span>{rental.fulfilment === "delivery" ? "Delivery" : "Collection"} · {rental.pickupTime ?? "Time to confirm"}</span><button onClick={() => onRental(rental._id)}>Manage rental →</button></footer></div>
          </article>)}
          {group.rows.length > DASHBOARD_PREVIEW_COUNT && <button className={styles.more} onClick={onRentals}>View all {group.rows.length} {group.key === "active" ? "active" : "verification"} rentals →</button>}
        </div>}
      </section>)}
    </div><aside className={styles.secondary}>
      {[...summary.ongoing,...summary.awaitingCollection].every(row=>Array.isArray(row.calendarLines)) ? <OperationsCalendar rentals={[...summary.ongoing,...summary.awaitingCollection]} onRental={onRental} onCalendar={onCalendar}/> : <section className={styles.panel}><h2>Rental calendar</h2><p className={styles.empty}>The calendar data is temporarily unavailable.</p><button className={styles.more} onClick={onCalendar}>Open calendar →</button></section>}
      <section className={`${styles.panel} ${styles.revenue}`}><header><h2>Rental receipts</h2><span>Last 6 months</span></header>{panels?.authorized ? <><strong className={styles.receiptTotal}>{formatGbp(panels.totalPence / 100)}</strong><p className={styles.panelNote}>Receipts by rental creation month · security excluded · recorded refunds deducted{panels.partialReceipts ? " · partial records" : ""}</p><svg viewBox="0 0 500 130" role="img" aria-label="Monthly recorded rental receipts"><title>Recorded rental receipts over six months</title>{[20,60,100].map(y => <path key={y} d={`M20 ${y}H485`} stroke="#ffffff10" />)}<polyline fill="none" stroke="#bd8d6c" strokeWidth="2" points={panels.months.map((m,i) => `${25+i*90},${110-(m.rentalPence/Math.max(1,...panels.months.map(n=>n.rentalPence)))*90}`).join(" ")} />{panels.months.map((m,i) => <circle key={m.at} cx={25+i*90} cy={110-(m.rentalPence/Math.max(1,...panels.months.map(n=>n.rentalPence)))*90} r="3" fill="#bd8d6c" />)}</svg><div className={styles.receiptMonths}>{panels.months.map(m=><span key={m.at}>{new Date(m.at).toLocaleDateString("en-GB",{month:"short",timeZone:"UTC"})}</span>)}</div></> : <p className={styles.empty}>Loading receipt records…</p>}</section>
      <section className={`${styles.panel} ${styles.inventory}`}><header><h2>Inventory at a glance</h2>{onInventory&&<button onClick={onInventory}>View inventory →</button>}</header><div className={styles.catalogueTiles}>{panels?.authorized&&panels.categories.map(c=><div key={c.name}><span>{c.name}</span><strong>{c.count}</strong><small>catalogue listings</small></div>)}</div>{panels?.authorized&&panels.partialCatalogue&&<p className={styles.panelNote}>First 1,000 catalogue listings shown.</p>}</section>
    </aside></div>
  </section>;
}
