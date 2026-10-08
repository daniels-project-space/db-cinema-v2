"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PICKUP_SLOTS } from "@/lib/site";
import styles from "./TimeSlotPicker.module.css";

export function TimeSlotPicker({ id, label, value, onChange, disabled=false }: {
  id: string; label: string; value: string; onChange: (time: string) => void; disabled?: boolean;
}) {
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 260, maxHeight: 320 });
  function show() { if(disabled)return; setActive(Math.max(0, PICKUP_SLOTS.indexOf(value))); setOpen(true); }
  function choose(index: number) { if(disabled)return; onChange(PICKUP_SLOTS[index]); setOpen(false); trigger.current?.focus(); }
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
    <button ref={trigger} id={id} type="button" disabled={disabled} role="combobox" aria-required="true"
      aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? menuId : undefined} aria-activedescendant={open ? `${menuId}-${active}` : undefined}
      className={`${styles.trigger} ${value ? styles.selected : ""}`}
      onClick={() => open ? setOpen(false) : show()}
      onBlur={event => { if (!menu.current?.contains(event.relatedTarget as Node)) setOpen(false); }}
      onKeyDown={event => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!open) show();
          else setActive(index => event.key === "Home" ? 0 : event.key === "End" ? PICKUP_SLOTS.length - 1 :
            (index + (event.key === "ArrowDown" ? 1 : -1) + PICKUP_SLOTS.length) % PICKUP_SLOTS.length);
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
        {PICKUP_SLOTS.map((time, index) => <div key={time} id={`${menuId}-${index}`} role="option"
          aria-selected={value === time} className={`${styles.option} ${active === index ? styles.active : ""} ${value === time ? styles.chosen : ""}`}
          onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>{time}</div>)}
      </div>
    </div>, document.body)}
  </div>;
}
