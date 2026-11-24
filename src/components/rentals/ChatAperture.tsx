"use client";

import { useId } from "react";

export function ChatAperture() {
  const id = useId().replace(/:/g, "");
  return <div aria-hidden="true" className="relative mx-auto grid h-24 w-24 place-items-center sm:h-28 sm:w-28">
    <span className="absolute inset-2 rounded-full bg-amber-300/10 blur-xl" />
    <span className="absolute inset-1 rounded-full border border-transparent border-t-amber-200/90 border-r-amber-300/40 motion-safe:animate-[spin_18s_linear_infinite_reverse]" />
    <span className="absolute right-2 top-4 h-1 w-1 rounded-full bg-amber-100 shadow-[0_0_12px_3px_rgba(255,200,112,.65)]" />
    <svg viewBox="0 0 100 100" className="relative h-20 w-20 drop-shadow-[0_0_15px_rgba(231,172,87,.25)] motion-safe:animate-[spin_30s_linear_infinite] sm:h-24 sm:w-24">
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffdb92"/><stop offset=".38" stopColor="#7b5531"/><stop offset=".7" stopColor="#211a16"/><stop offset="1" stopColor="#e5b66e"/></linearGradient></defs>
      <circle cx="50" cy="50" r="39" fill="#171513" stroke="#9b784c" strokeWidth=".7" />
      {Array.from({ length: 6 }, (_, index) => <path key={index} transform={`rotate(${index * 60} 50 50)`} d="M49 11C64 10 76 19 84 31L65 45 46 32Z" fill={`url(#${id})`} stroke="#e4bd80" strokeOpacity=".65" strokeWidth=".6" />)}
      <path d="M42 35h16l8 15-8 15H42l-8-15Z" fill="#101012" stroke="#d8a85f" strokeOpacity=".5" strokeWidth=".7" />
    </svg>
  </div>;
}
