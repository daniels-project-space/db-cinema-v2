import { SiteHeader } from "@/components/SiteHeader";
import { EmailLink } from "@/components/EmailLink";

export default function WebsiteUsePage() {
  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-3xl px-6 py-12">
        <div className="hud-label !text-accent-400/90">Legal</div>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">Website use &amp; AI</h1>
        <p className="mt-2 font-mono text-xs text-white/30">Last updated November 2026</p>
        <div className="mt-10 flex flex-col gap-7 text-sm leading-relaxed text-white/60">
          <section>
            <h2 className="font-display text-lg font-semibold text-white/80">Copyright and permitted use</h2>
            <p className="mt-2">The original content, imagery, branding, code and design on this website belong to DB Cinema Rentals or their respective rights holders. All rights are reserved. You may browse the website and use it to enquire about or book equipment. Except where the law permits, you may not copy, reproduce, distribute or reuse this material without prior written permission from the relevant rights holder.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-white/80">AI and automated use</h2>
            <p className="mt-2">We do not grant permission to collect or use this website’s protected material to train or develop AI models, or to recreate this website or its original content using AI, without prior written permission. This notice applies to material DB Cinema Rentals owns or is authorised to control and is subject to applicable law.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-white/80">Permission</h2>
            <p className="mt-2">For permission requests, contact <EmailLink className="underline hover:text-white" />.</p>
          </section>
        </div>
      </main>
    </>
  );
}
