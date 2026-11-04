"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { FilmFundHeart } from "./FilmFundHeart";
import styles from "./FilmFundPrizeChart.module.css";

export type FilmFundPrize = { number:string; title:string; label:string; note:string; points:string[] };

export function FilmFundPrizeChart({ prizes }: { prizes: FilmFundPrize[] }) {
  const chart = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = chart.current;
    if (!node || !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.15 });
    setReady(true);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const maxDays = Math.max(...prizes.map(prize => Number(prize.number)));
  return <div ref={chart} className={styles.chart} data-ready={ready} data-visible={visible}>
    {prizes.map((prize, index) => {
      const height = `${Number(prize.number) / maxDays * 72}%`;
      return <article className={`${styles.award} ${index === 0 ? styles.first : ""}`} key={prize.number}>
        <div className={styles.heading}><span>{index === 0 ? "First award" : "Second award"}</span><FilmFundHeart className={styles.heart}/></div>
        <div className={styles.plot} style={{ "--bar-height": height } as CSSProperties}>
          <div className={styles.plotLine} aria-hidden="true"/>
          <div className={styles.bar} data-prize-bar aria-hidden="true"><span/></div>
          <div className={styles.value}><span className={styles.upTo}>Up to</span><strong>{prize.number}</strong><span>{prize.label}</span></div>
        </div>
        <div className={styles.details}><h3>{prize.title}</h3><p>{prize.note}</p><ul>{prize.points.map(point => <li key={point}><span aria-hidden="true">↗</span>{point}</li>)}</ul></div>
      </article>;
    })}
  </div>;
}
