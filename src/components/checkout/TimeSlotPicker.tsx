"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PICKUP_SLOTS } from "@/lib/site";
import styles from "./TimeSlotPicker.module.css";

export function TimeSlotPicker({ id, label, value, onChange, disabled=false, allowedSlots }: {
  id: string; label: string; value: string; onChange: (time: string) => void; disabled?: boolean; allowedSlots?: string[];
}) {
  const slots=PICKUP_SLOTS;
  const allowed=(time:string)=>!allowedSlots||allowedSlots.includes(time);
  const available=slots.map((time,index)=>allowed(time)?index:-1).filter(index=>index>=0);
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(()=>{if(disabled||!available.length)setOpen(false);},[disabled,available.length]);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 260, maxHeight: 320 });
  function show() { if(disabled||!available.length)return; setActive(allowed(value)?Math.max(0,slots.indexOf(value)):available[0]); setOpen(true); }
  function choose(index: number) { if(disabled||!available.length||!allowed(slots[index]))return; onChange(slots[index]); setOpen(false); trigger.current?.focus(); }
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 260), innerWidth - 24);
      const below = innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const height = Math.min(310, Math.max(below, above), innerHeight - 24);
      const top = below >= 260 || below >= above ? rect.bottom + 6 : rect.top - height - 6;
      setPosition({ left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)),
        top: Math.max(12, Math.min(top, innerHeight - height - 12)),
        width, maxHeight: height });
    };
    place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className={styles.field}>
    <label id={`${id}-label`} htmlFor={id} className={styles.label}>{label}</label>
    <button ref={trigger} id={id} type="button" disabled={disabled||!available.length} role="combobox" aria-required="true"
      aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? menuId : undefined} aria-activedescendant={open ? `${menuId}-${active}` : undefined}
      className={`${styles.trigger} ${value ? styles.selected : ""}`}
      onClick={() => open ? setOpen(false) : show()}
      onBlur={event => { if (!menu.current?.contains(event.relatedTarget as Node)) setOpen(false); }}
      onKeyDown={event => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!open) show();
          else if(available.length)setActive(index=>event.key==="Home"?available[0]:event.key==="End"?available.at(-1)!:available[(Math.max(0,available.indexOf(index))+(event.key==="ArrowDown"?1:-1)+available.length)%available.length]);
        } else if (open && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); choose(active); }
        else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        else if (event.key === "Tab") setOpen(false);
      }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>
      <span id={`${id}-value`}>{value || "Choose a time"}</span>
      <svg className={styles.chevron} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 8 5 5 5-5"/></svg>
    </button>
    {open && createPortal(<div ref={menu} className={styles.menu} style={position}>
      <div className={styles.caption}>London time · 09:00–22:00</div>
      <div id={menuId} role="listbox" aria-labelledby={`${id}-label`} className={styles.slots}>
        {slots.map((time, index) => <div key={time} id={`${menuId}-${index}`} role="option"
          aria-selected={value === time} aria-disabled={!allowed(time)} style={!allowed(time)?{opacity:0.3,cursor:"not-allowed"}:undefined} className={`${styles.option} ${active === index ? styles.active : ""} ${value === time ? styles.chosen : ""}`}
          onPointerMove={() => {if(allowed(time))setActive(index)}} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>{time}</div>)}
      </div>
    </div>, document.body)}
  </div>;
}
