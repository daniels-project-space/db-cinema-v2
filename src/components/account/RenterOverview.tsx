"use client";

import Link from "next/link";
import {BookingTile} from "./BookingTile";
import {BookingSections} from "./BookingSections";
import {RentalCalendar} from "./RentalCalendar";
import {SmartImage} from "@/components/SmartImage";
import {groupOf,type EnrichedBooking} from "@/lib/bookingDisplay";
import styles from "./RenterOverview.module.css";

/** Renter-owned rentals and conversations only. Operational/account-directory
 * controls belong to the separate admin workspace. */
export function RenterOverview({bookings,token,historyLoading,unreadMessages,onOpenChat,onOpenCalendar}: {
  bookings:EnrichedBooking[]|null|undefined;token:string;historyLoading:boolean;unreadMessages:number;
  onOpenChat:(bookingId?:string)=>void;onOpenCalendar:()=>void;
}) {
  const rentals=bookings??[];
  const featured=["active","upcoming","pending"].flatMap(group=>rentals.filter(b=>groupOf(b)===group)
    .sort((a,b)=>(group==="active"?a.end??a.at:a.start??a.at)-(group==="active"?b.end??b.at:b.start??b.at)))[0];
  const remaining=featured?rentals.filter(b=>b._id!==featured._id):rentals;
  return <div className={styles.root} data-testid="renter-overview">
    <div className={styles.toolbar}><p>Your equipment, dates and conversations.</p><nav aria-label="Rental shortcuts"><button type="button" onClick={onOpenCalendar}>Calendar</button><button type="button" onClick={()=>onOpenChat(featured?._id)}>Messages{unreadMessages>0?` (${unreadMessages})`:""}</button><Link href="/gear">Browse equipment <span aria-hidden>→</span></Link></nav></div>
    {historyLoading&&<p role="status" className={styles.loading}>Loading the rest of your rental history…</p>}

    <div className={styles.workspace}>
      <div className={styles.primary}>
    {bookings===undefined?<p role="status" className={styles.loading}>Loading your rentals…</p>:featured?<BookingTile booking={featured} token={token} featured onOpenChat={onOpenChat}/>:<section className={styles.empty}><h2>{rentals.length?"Your next rental starts here":"Welcome to your rental workspace"}</h2><p>Browse equipment, choose your dates and keep the booking conversation here.</p><Link href="/gear">Find equipment →</Link></section>}
        {featured&&<section className={styles.kit}><header><h2>Kit contents</h2><span>{featured.lineItems.reduce((sum,line)=>sum+line.qty,0)} items</span></header><div className={styles.kitStrip}>
          {featured.lineItems.map((line,index)=><article key={`${line.listingId}-${index}`} className={styles.kitItem}>
            <SmartImage src={line.heroImage} fallbackSources={line.imageSources} alt={line.title} className={styles.kitImage}/>
            <strong>{line.title}</strong><span>Quantity {line.qty}</span>
            <small>{new Date(line.start).toLocaleDateString("en-GB",{timeZone:"UTC",day:"numeric",month:"short"})} – {new Date(line.end).toLocaleDateString("en-GB",{timeZone:"UTC",day:"numeric",month:"short"})}</small>
          </article>)}
        </div></section>}
        <section className={styles.history}><header><h2>{featured?"Other rentals":"Rental history"}</h2><button type="button" onClick={onOpenCalendar}>View calendar →</button></header>
          {remaining.length?<BookingSections bookings={remaining} token={token} onOpenChat={onOpenChat} featureFirst={false}/>:<p>{historyLoading?"Checking for more rentals…":"No other rentals to show."}</p>}
        </section>
      </div>
      <aside className={styles.agenda} aria-label="Your rental calendar and messages">
        <RentalCalendar bookings={bookings} loading={historyLoading} onOpenRental={onOpenChat}/>
        <section className={styles.conversations}><header><h2>Your conversations</h2>{unreadMessages>0&&<span className={styles.unread}>{unreadMessages} unread</span>}</header><p>Keep collection times, equipment questions and booking changes together in your rental chat.</p>
          {featured&&<button type="button" onClick={()=>onOpenChat(featured._id)}>Message about this rental <span aria-hidden>→</span></button>}
          <button type="button" className={styles.support} onClick={()=>onOpenChat("general")}>Contact the rental team <span aria-hidden>→</span></button>
        </section>
      </aside>
    </div>
  </div>;
}
