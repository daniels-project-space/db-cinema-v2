"use client";

import styles from "./HomeClosingAperture.module.css";

export function HomeApertureArt({ id }: { id: string }) {
  return <svg className={styles.blades} viewBox="0 0 120 120" focusable="false" aria-hidden="true">
    <defs>
      <radialGradient id={`${id}-depth`}><stop offset="0" stopColor="#010102"/><stop offset=".58" stopColor="#090809"/><stop offset=".9" stopColor="#160f0b"/><stop offset="1" stopColor="#030304"/></radialGradient>
      <linearGradient id={`${id}-metal`} x1=".1" y1=".12" x2=".88" y2=".93"><stop offset="0" stopColor="#fff0d8"/><stop offset=".12" stopColor="#9f623d"/><stop offset=".38" stopColor="#34231b"/><stop offset=".64" stopColor="#d38a56"/><stop offset=".82" stopColor="#513324"/><stop offset="1" stopColor="#f4bd8b"/></linearGradient>
      <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff0d8" stopOpacity=".68"/><stop offset=".45" stopColor="#df9562" stopOpacity=".14"/><stop offset="1" stopColor="#1c100a" stopOpacity=".7"/></linearGradient>
    </defs>
    <circle cx="60" cy="60" r="57" className={styles.outerRing}/>
    <circle cx="60" cy="60" r="52" className={styles.trackRing}/>
    <circle cx="60" cy="60" r="47" className={styles.innerRing}/>
    <g className={styles.ticks}>{Array.from({ length: 48 }, (_, index) => <line key={index} x1="60" y1={index % 4 === 0 ? 3.5 : 4.5} x2="60" y2={index % 4 === 0 ? 9 : 7} transform={`rotate(${index * 7.5} 60 60)`} className={index % 4 === 0 ? styles.majorTick : ""}/>)}</g>
    <circle cx="60" cy="60" r="47" fill={`url(#${id}-depth)`}/>
    <g className={styles.bladeStack}>{Array.from({ length: 8 }, (_, index) => <g key={index} transform={`rotate(${index * 45} 60 60)`}>
      <g className={styles.blade} data-aperture-blade="">
        <path className={styles.bladeFace} style={{ fill: `url(#${id}-metal)` }} d="M55 14 C73 9 92 17 104 30 L87 43 C78 33 67 27 53 29 Z"/>
        <path className={styles.bladeHighlight} style={{ stroke: `url(#${id}-edge)` }} d="M55 15 C73 10 91 18 102 30"/>
      </g>
    </g>)}</g>
    <circle cx="60" cy="60" r="20" fill={`url(#${id}-depth)`} className={styles.core}/>
    <circle cx="60" cy="60" r="20" className={styles.coreRim}/>
    <circle cx="60" cy="60" r="4" className={styles.coreGlint}/>
    <g className={styles.screws}>{Array.from({ length: 8 }, (_, index) => <g key={index} transform={`rotate(${index * 45} 60 60)`}><circle cx="60" cy="8" r="1.4"/><path d="M59.1 8h1.8"/></g>)}</g>
  </svg>;
}
