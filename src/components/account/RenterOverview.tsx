"use client";

import Link from "next/link";
import {useState} from "react";
import {BookingTile} from "./BookingTile";
import {BookingSections} from "./BookingSections";
import {RentalCalendar} from "./RentalCalendar";
import {SmartImage} from "@/components/SmartImage";
import {formatGbp} from "@/lib/pricing";
import {rentalTitle} from "@/lib/rentalPresentation";
import {groupOf,fmtRange,type EnrichedBooking} from "@/lib/bookingDisplay";
import styles from "./RenterOverview.module.css";

/** Renter-owned rentals and conversations only. Operational/account-directory
 * controls belong to the separate admin workspace. */
export function RenterOverview({bookings,token,historyLoading,unreadMessages,onOpenChat,onOpenCalendar}: {
  bookings:EnrichedBooking[]|null|undefined;token:string;historyLoading:boolean;unreadMessages:number;
  onOpenChat:(bookingId?:string)=>void;onOpenCalendar:()=>void;
}) {
  const [expanded,setExpanded]=useState<string|null>(null);
  const rentals=bookings??[];
  const featured=["active","upcoming","pending"].flatMap(group=>rentals.filter(b=>groupOf(b)===group)
    .sort((a,b)=>(group==="active"?a.end??a.at:a.start??a.at)-(group==="active"?b.end??b.at:b.start??b.at)))[0];
  const remaining=featured?rentals.filter(b=>b._id!==featured._id):rentals;
  return <div className={styles.root} data-testid="renter-overview">
    <div className={styles.toolbar}><p>Your equipment, dates and conversations.</p><nav aria-label="Rental shortcuts"><button type="button" onClick={onOpenCalendar}>Calendar</button><button type="button" onClick={()=>onOpenChat(featured?._id)}>Messages{unreadMessages>0?` (${unreadMessages})`:""}</button><Link href="/gear">Browse equipment <span aria-hidden>→</span></Link></nav></div>
    {historyLoading&&<p role="status" className={styles.loading}>Loading the rest of your rental history…</p>}

    {bookings===undefined?<p role="status" className={styles.loading}>Loading your rentals…</p>:featured?<BookingTile booking={featured} token={token} featured onOpenChat={onOpenChat}/>:<section className={styles.empty}><h2>{rentals.length?"Your next rental starts here":"Welcome to your rental workspace"}</h2><p>Browse equipment, choose your dates and keep the booking conversation here.</p><Link href="/gear">Find equipment →</Link></section>}
    <div className={styles.workspace}>
      <div className={styles.primary}>
        {featured&&<section className={styles.kit}><header><h2>Kit contents</h2><span>{featured.lineItems.reduce((sum,line)=>sum+line.qty,0)} items</span></header><div className={styles.kitStrip}>
          {featured.lineItems.map((line,index)=><article key={`${line.listingId}-${index}`} className={styles.kitItem}>
            <SmartImage src={line.heroImage} fallbackSources={line.imageSources} alt={line.title} className={styles.kitImage}/>
            <strong>{line.title}</strong><span>Quantity {line.qty}</span>
            <small>{new Date(line.start).toLocaleDateString("en-GB",{timeZone:"UTC",day:"numeric",month:"short"})} – {new Date(line.end).toLocaleDateString("en-GB",{timeZone:"UTC",day:"numeric",month:"short"})}</small>
          </article>)}
        </div></section>}

      </div>
      <aside className={styles.agenda} aria-label="Your rental calendar and messages">
        <RentalCalendar bookings={bookings} loading={historyLoading} onOpenRental={onOpenChat}/>

      </aside>
    </div>
    <div className={styles.rentalArchive}>
      {[{key:"upcoming",title:"Upcoming rentals",rows:remaining.filter(b=>groupOf(b)==="upcoming"||groupOf(b)==="active")},{key:"past",title:"Past rentals",rows:remaining.filter(b=>groupOf(b)==="past")}].map(group=><section key={group.key} className={styles.history}><header><h2>{group.title}</h2><button type="button" onClick={()=>setExpanded(expanded===group.key?null:group.key)}>{expanded===group.key?"Show fewer":"View all"} →</button></header><table><thead><tr><th>Equipment</th><th>Dates</th><th>{group.key==="past"?"Total":"Status"}</th><th>{group.key==="past"?"Receipt":"Total"}</th></tr></thead><tbody>{group.rows.slice(0,expanded===group.key?group.rows.length:3).map(b=><tr key={b._id}><td><button type="button" className={styles.archiveRental} onClick={()=>onOpenChat(b._id)}><SmartImage src={b.lineItems[0]?.heroImage} fallbackSources={b.lineItems[0]?.imageSources} alt="" className={styles.archivePhoto}/><span>{rentalTitle(b.lineItems[0]?.title??"Rental kit")}</span></button></td><td>{b.start!=null&&b.end!=null?fmtRange(b.start,b.end):"To confirm"}</td><td>{group.key==="past"?formatGbp(b.total):<span className={styles.archiveStatus}>{b.status==="active"?"On hire":"Confirmed"}</span>}</td><td>{group.key==="past"&&b.status==="returned"&&token&&token!=="preview"?<a href={`/api/invoice/${b._id}?token=${encodeURIComponent(token)}`} target="_blank" rel="noopener noreferrer">PDF</a>:group.key==="past"?b.status:formatGbp(b.total)}</td></tr>)}</tbody></table>{!group.rows.length&&<p>{historyLoading?"Loading rentals…":"No rentals to show."}</p>}</section>)}
      <section className={styles.conversations}><header><h2>Need support?</h2>{unreadMessages>0&&<span className={styles.unread}>{unreadMessages} unread</span>}</header><p>Our team can help with bookings, collections and equipment questions.</p>{featured&&<button type="button" onClick={()=>onOpenChat(featured._id)}>Message about this rental <span aria-hidden>→</span></button>}<button type="button" className={styles.support} onClick={()=>onOpenChat("general")}>Contact the rental team <span aria-hidden>→</span></button></section>
    </div>
    {remaining.length>0&&<details className={styles.allActions} open={remaining.some(b=>groupOf(b)==="pending")||undefined}><summary>{remaining.some(b=>groupOf(b)==="pending")?"Payment needed · ":""}All rental details & actions</summary><BookingSections bookings={remaining} token={token} onOpenChat={onOpenChat} featureFirst={false}/></details>}
  </div>;
}
