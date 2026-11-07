"use client";

import { IconArrowRight } from "@/components/icons";

const QUICK_STARTS = [
  {
    label: "Build a kit",
    prompt: "Help me build a kit for a film shoot. Ask me about the shoot, camera system, budget, quantities, and rental dates before recommending gear with basket cards.",
  },
  {
    label: "Check dates",
    prompt: "I want to check availability for specific gear. Ask me for the exact items and pickup and return dates and times you need.",
  },
  {
    label: "Get a quote",
    prompt: "I need a rental quote. Ask me which gear and pickup and return dates and times you need before quoting.",
  },
  {
    label: "Ask a question",
    prompt: "I have a general question about renting, delivery, prices, security, opening hours, or changing a booking. Please answer from the current website information, and tell me when something depends on my signed rental terms.",
  },
  {
    label: "My booking",
    prompt: "I have a question about my booking. Please check the booking details available in my signed-in account and tell me what you can confirm.",
  },
];

function openGaffer(prompt?: string) {
  window.dispatchEvent(new CustomEvent("dbc:open-gaffer-chat", { detail: { prompt } }));
}

export function OpenGafferChat() {
  return (
    <section aria-label="Ask Gaffer" className="spot rounded-2xl p-5 sm:p-6">
      <button type="button" onClick={() => openGaffer()}
        className="group flex w-full items-center justify-between gap-4 text-left">
        <span className="min-w-0"><span className="block font-display text-base font-semibold text-white/90">Chat with Gaffer</span>
          <span className="mt-1 block text-sm leading-relaxed text-white/60">Get live kit ideas, basket cards, date checks and rental quotes.</span></span>
        <IconArrowRight className="h-5 w-5 shrink-0 text-accent-300 transition-transform group-hover:translate-x-1" />
      </button>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {QUICK_STARTS.map((action) => (
          <button key={action.label} type="button" onClick={() => openGaffer(action.prompt)}
            className="min-h-10 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-left text-sm text-white/75 transition hover:border-accent-300/35 hover:bg-accent-400/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300/70">
            {action.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-white/40">Choose a starting point, review the draft in chat, then send it. Gaffer can suggest gear, create item cards and check prices and stock; it cannot reserve items from a basket.</p>
    </section>
  );
}
