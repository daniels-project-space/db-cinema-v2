"use client";
import { useState } from "react";
import { rentalTitle } from "@/lib/rentalPresentation";
import { londonStartOfDay } from "@/lib/bookingDisplay";
import { groupCalendarLinesByPeriod, type CalendarLine } from "@/lib/rentalCalendar";
import styles from "./AdminDashboard.module.css";

type Rental = { _id:string; customerName?:string|null; guestEmail?:string; status:string; calendarLines:CalendarLine[] };
const DAY=86400000;
const weekdays=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
function currentMonth(){const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"numeric"}).formatToParts(new Date());return {year:Number(parts.find(p=>p.type==="year")!.value),month:Number(parts.find(p=>p.type==="month")!.value)-1};}
export function OperationsCalendar({rentals,onRental,onCalendar}:{rentals:Rental[];onRental:(id:string)=>void;onCalendar:()=>void}){
  const [month,setMonth]=useState(currentMonth);
  const first=Date.UTC(month.year,month.month,1),last=Date.UTC(month.year,month.month+1,0);
  const lead=(new Date(first).getUTCDay()+6)%7,begin=first-lead*DAY;
  const weeks=Math.ceil((lead+new Date(last).getUTCDate())/7);
  const today=londonStartOfDay(Date.now());
  const shift=(offset:number)=>{const date=new Date(Date.UTC(month.year,month.month+offset,1));setMonth({year:date.getUTCFullYear(),month:date.getUTCMonth()});};
  return <section className={`${styles.panel} ${styles.calendar}`} aria-label="Operational rental calendar">
    <header><h2>{new Intl.DateTimeFormat("en-GB",{month:"long",year:"numeric",timeZone:"UTC"}).format(first)}</h2><div className={styles.monthControls}><button aria-label="Previous operations month" onClick={()=>shift(-1)}>‹</button><button aria-label="Next operations month" onClick={()=>shift(1)}>›</button><button onClick={()=>setMonth(currentMonth())}>Today</button></div></header>
    <p className={styles.calendarScope}><i/> DB Cinema Web · on hire and confirmed rentals</p>
    <div className={styles.weekdays}>{weekdays.map(day=><span key={day}>{day}</span>)}</div>
    <div className={styles.monthGrid}>{Array.from({length:weeks},(_,week)=>{
      const weekStart=begin+week*7*DAY,weekEnd=weekStart+6*DAY;
      const segments=rentals.flatMap(rental=>groupCalendarLinesByPeriod(rental.calendarLines).flatMap((period,index)=>{
        const from=Math.max(period.start,weekStart,first),to=Math.min(period.end,weekEnd,last);
        if(to<from)return [];
        return [{rental,lines:period.lines,index,start:(from-weekStart)/DAY,end:(to-weekStart)/DAY}];
      })).sort((a,b)=>a.start-b.start||b.end-a.end||a.rental._id.localeCompare(b.rental._id)||a.index-b.index);
      const lanes:number[]=[];
      const events=segments.map(segment=>{let lane=lanes.findIndex(end=>end<segment.start);if(lane<0)lane=lanes.length;lanes[lane]=segment.end;return {...segment,lane};});
      return <div key={week} className={styles.week}>
        <div className={styles.days}>{Array.from({length:7},(_,day)=>{const date=weekStart+day*DAY;return <span key={day} data-outside={date<first||date>last} data-today={date===today}>{new Date(date).getUTCDate()}</span>;})}</div>
        <div className={styles.events} style={{gridTemplateRows:`repeat(${Math.max(lanes.length,1)},23px)`}}>{events.map(event=>{
          const equipment=event.lines.map(line=>`${line.qty>1?`${line.qty} × `:""}${rentalTitle(line.title)}`).join(" + ");
          const customer=event.rental.customerName||event.rental.guestEmail||"Rental customer";
          return <button key={`${event.rental._id}-${event.start}-${event.end}`} onClick={()=>onRental(event.rental._id)} style={{gridColumn:`${event.start+1} / ${event.end+2}`,gridRow:event.lane+1}} title={`${equipment} · ${customer}`} aria-label={`Manage ${equipment} for ${customer}`}><span>{equipment} · {customer}</span></button>;
        })}</div>
      </div>;
    })}</div>
    <button className={styles.calendarLink} onClick={onCalendar}>Open full rental calendar →</button>
  </section>;
}
