"use client";
import { useLiveRecommendations } from "@/components/useLiveRecommendations";

import { pickRentalDates } from "@/lib/dateSelection";
import { SmartImage } from "@/components/SmartImage";

import { useState, useEffect, useMemo, useRef } from "react";
import { liveWindow, stockLines } from "@/lib/liveRecommendations";
import { IconSliders, IconBolt, IconCheck, IconX, IconChevronLeft, IconArrowRight } from "@/components/icons";
import { BotAvatarBadge, type BotMood } from "@/components/chat/BotAvatar";
import { Stream, TypingIndicator } from "@/components/chat/ChatKit";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { GearLoopBanner } from "@/components/GearLoopBanner";
import { useCart } from "@/components/cart/CartProvider";
import { useAccount } from "@/components/account/AccountProvider";
import { tierByKey } from "@/lib/membership";
import { lensFits, parseMounts } from "@/lib/mount";
import { kitWarnings, battOk } from "@/lib/compat";
import { GlowSlider } from "@/components/GlowSlider";
import { TimeSlotPicker } from "@/components/checkout/TimeSlotPicker";
import { Calendar, daysInclusive } from "@/components/booking/Calendar";
import { filterThreadsFor } from "../../../shared/opticalFacts";
import { scoreOption } from "@/lib/kitRank";
import { alreadySupplied, automaticRecommendation, documentedIncludedTypes, includedLensFocals, lensFit, matchesAssemblyBrief, matchesAssemblyCamera } from "../../../shared/recommendationPolicy";

const EMPTY_DATES = new Set<string>();

// stage key → the itemType it represents (for "already in the chosen set" suppression)
const STAGE_TYPE: Record<string, string> = {
  camera: "camera-body", lens: "lens", gimbal: "gimbal", monitor: "monitor",
  light: "light", "key-light": "light", "tube-light": "light", "nd-filter": "nd-filter",
  battery: "battery", tripod: "tripod", "lav-mic": "wireless-mic", "wireless-mic": "wireless-mic",
  "shotgun-mic": "boom-mic", slider: "slider", drone: "drone", speaker: "speaker",
  recorder:"recorder","dj-deck":"dj-deck",mixer:"mixer",headphones:"headphones",projector:"projector",accessory:"accessory",
};

const SHOOTS = ["Interview", "Music video", "Documentary", "Event", "Product", "Wedding", "Other"];
const SIZES = ["Solo", "Small crew", "Large production"];
const CATEGORIES = ["Lenses", "Lighting", "Audio", "Stabilisation", "Support", "Monitoring", "DJ & sound", "Recording", "Projection", "Drones", "Accessories"];

// roleToType: assemble options carry a coarse `role`; map to the engine's itemType
// (the API also sends `itemType` directly — prefer it, fall back to role).
const typeOf = (x: any): string =>
  x.itemType ?? (x.role === "camera" ? "camera-body" : x.role === "lens" ? "lens" : x.category ?? "accessory");

export default function AssemblePage() {
  const router = useRouter();
  const cart = useCart();
  const account = useAccount();
  const tier = account.me?.membershipActive ? tierByKey(account.me.membershipTier) : null;
  const memberPct = tier?.pct ?? 0;

  const [shootType, setShootType] = useState("Interview");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [returnTime, setReturnTime] = useState("");
  const [month, setMonth] = useState(() => new Date());
  function pickDate(d: string) {
    const next = pickRentalDates(start, end, d);
    setStart(next.start);
    setEnd(next.end);
  }
  const [budget, setBudget] = useState(600);
  const [cameras, setCameras] = useState(1);
  const [size, setSize] = useState("Small crew");
  const [note, setNote] = useState("");
  const [gearCats, setGearCats] = useState<string[]>([]);
  const [intake, setIntake] = useState(0); // conversational onboarding step
  const endRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [stageIdx, setStageIdx] = useState(0);
  const [sel, setSel] = useState<Record<string, any>>({});
  const [err, setErr] = useState<string | null>(null);

  const rawSelection = Object.values(sel) as any[];
  const live:any = useLiveRecommendations(data ? {
    groups:data.stages.map((s:any)=>({key:s.key,types:[STAGE_TYPE[s.key]??s.key],listingId:rawSelection.find(i=>i.stageKey===s.key)?.listingId || (s.key === "camera" || s.briefConstraint ? s.recommendedId || s.briefPreferredId || s.cameraPreferredId : undefined) || undefined,...liveWindow({start,end,pickupTime,returnTime})})),
    basket:stockLines(cart.items),selectedIds:rawSelection.map(i=>i.listingId),
  } : null);
  const selList = rawSelection.map(item=>({...item,...live?.groups[item.stageKey]?.selection?.find((current:any)=>current.listingId===item.listingId)}));
  const contextList = [...selList,...(live?.basket??[])];
  const cams = contextList.filter((x) => x.role === "camera");
  const camMounts = cams.flatMap((c) => parseMounts(c.mount));
  const actionOnly = camMounts.length > 0 && camMounts.every((m) => m === "fixed");
  const camBatts = cams.map((c) => c.specs?.batteryType).filter(Boolean);
  const camIncludesLens = cams.some((c) => includedLensFocals(c).length > 0);
  const cinemaRig = cams.some((c) => /cine|cinema|fx ?6|fx ?9|c ?70|c ?100|c ?200|c ?300|c ?500|c ?400|alexa|amira|ursa|komodo|raptor|venice|burano|bmpcc|pocket cinema|\bred\b/i.test(c.title || ""));
  // secondary gear the chosen camera SET already contains — never re-recommend it (its unit is booked in the bundle)
  const includedTypes = new Set<string>(contextList.flatMap((c: any) => documentedIncludedTypes(c)));
  const lensThreads = contextList.flatMap(filterThreadsFor);

  // ── DYNAMIC TREE: downstream stages re-rank around what's ACTUALLY selected ──────────────
  // (pick a Blackmagic EF body → Canon glass tops; pick Sony → Sony battery; add a gimbal →
  //  its gimbal battery surfaces). All recomputed client-side from the live selection.
  const hasGimbal = selList.some((x) => x.itemType === "gimbal" || x.role === "gimbal" || /\bgimbal\b|ronin|\brs ?[234]\b/i.test(x.title || ""));
  const camCov = (cams[0] as any)?.specs?.coverage ?? null;
  const inclFocal = cams.find((c: any) => c.specs?.includesLens && c.specs?.lensFocal)?.specs?.lensFocal ?? null;
  const lensPref = /large/i.test(size) ? "cine" : "af";
  const smallShoot = /solo|small/i.test(size) || !size;
  // ONE scoring formula, shared with /api/assemble — re-ranks the live selection's downstream stages.
  const dynScore = (o: any, key: string) =>
    scoreOption(o, { key, camMounts, camCoverage: camCov, camBatts, cinemaRig, hasGimbal, includedFocal: inclFocal, small: smallShoot, lensPref });
  const cameraConstraintFor = (stage: any) => {
    const constraint = stage?.cameraConstraint;
    if (!constraint?.requiresLens) return constraint;
    const lensStage = data?.stages?.find((candidate: any) => candidate.key === "lens");
    const group = live?.groups?.lens;
    const selectedLens = selList.find((item: any) => item.stageKey === "lens");
    const candidates = [group?.preferred, ...(group?.options ?? [])].filter(Boolean);
    const lens = selectedLens
      ? selectedLens.available === true ? selectedLens : null
      : candidates.find((item: any) => item.available === true && lensStage?.briefConstraint && matchesAssemblyBrief(item, lensStage.briefConstraint)) ?? null;
    return { ...constraint, requestedLens: lens };
  };
  // the recommended ("Pick") id for a stage, re-derived from the current selection
  const dynRec = (s: any): string => {
    if (!s || !live) return "";
    const stype = STAGE_TYPE[s.key];
    if (stype && stype !== "lens" && includedTypes.has(stype)) return ""; // already in the chosen set — don't pre-pick
    const context=contextList.filter(i=>i.stageKey!==s.key||["lens","light","nd-filter","battery","lav-mic"].includes(s.key));
    const v = visibleFor(s).filter((o: any) => o.available===true && !incompatOf(o, s) &&
      !alreadySupplied(o, context.filter(i => i.listingId !== o.listingId)) &&
      (s.key !== "camera" || !s.cameraConstraint || matchesAssemblyCamera(o, cameraConstraintFor(s))) &&
      (!s.briefConstraint || matchesAssemblyBrief(o, s.briefConstraint)) &&
      (s.key === "lens" && s.briefConstraint && cams.length === 0 || automaticRecommendation(o, context.filter(i => i.listingId !== o.listingId), live.compatibilityKits)));
    if((s.key==="camera" || s.briefConstraint)&&v.some((o:any)=>o.listingId===s.recommendedId))return s.recommendedId;
    return v.length ? [...v].sort((a: any, b: any) => dynScore(b, s.key) - dynScore(a, s.key))[0].listingId : "";
  };

  const subtotal = selList.reduce((n, c) => n + (c.total || 0), 0);
  const memberDiscount = Math.round((subtotal * memberPct) / 100);
  const finalTotal = subtotal - memberDiscount;
  const overBudget = finalTotal > budget;

  // prune lenses that no longer fit the chosen camera(s) (e.g. switched to a GoPro)
  const camKey = cams.map((c) => `${c.listingId}:${c.mount}`).join(",");
  useEffect(() => {
    setSel((prev) => {
      const n = { ...prev };
      let changed = false;
      for (const x of Object.values(prev) as any[]) {
        const t = STAGE_TYPE[x.stageKey];
        if (x.role === "lens" && !lensFits(x.mount, camMounts)) {
          delete n[x.listingId];
          changed = true;
        } else if (t && x.stageKey !== "camera" && x.stageKey !== "lens" && x.stageKey !== "battery" && includedTypes.has(t)) {
          // the chosen set now covers this category → drop the redundant pick (its stage is hidden, so it
          // would otherwise be stuck in the kit + cart with no way to deselect it)
          delete n[x.listingId];
          changed = true;
        }
      }
      return changed ? n : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camKey, [...includedTypes].sort().join(",")]);

  // keep the conversation scrolled to the newest message/stage
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [intake, stageIdx, data]);

  async function build() {
    if (!start || !end || !pickupTime || !returnTime) {
      setErr("Choose your rental dates, pickup time and return time first.");
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const r = await fetch("/api/assemble", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shootType, start, end, pickupTime, returnTime, budget, cameras, size, note, categories: gearCats }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "Could not build a kit for those dates and times.");
      setData(d);
      setStageIdx(0);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Something went wrong — try again.");
    } finally {
      setLoading(false);
    }
  }

  function toggle(card: any, stage: any) {
    setSel((prev) => {
      const n = { ...prev };
      if (n[card.listingId]) {
        delete n[card.listingId];
        return n;
      }
      const same = (Object.values(n) as any[]).filter((x) => x.stageKey === stage.key);
      if (stage.key === "camera") {
        if (same.length >= cameras && same[0]) delete n[same[0].listingId];
      } else if (!stage.multi) {
        for (const s of same) delete n[s.listingId];
      }
      n[card.listingId] = { ...card, stageKey: stage.key };
      return n;
    });
  }

  function addAll() {
    if(!canAddSelection)return;
    for (const c of selList)
      cart.add({
        listingId: c.listingId, slug: c.slug, title: c.title, heroImage: c.image ?? null,
        start: c.start, end: c.end, pickupTime: c.pickupTime, returnTime: c.returnTime, days: c.days, perDay: c.perDay, total: c.total, deposit: c.deposit ?? 0,
      });
    router.push("/cart");
  }

  const chip = (a: boolean) =>
    `rounded-full px-4 py-1.5 text-sm transition-colors ${a ? "bg-accent-500 text-white" : "glass text-white/55 hover:text-white"}`;

  const stages = data?.stages ?? [];
  // a single-pick item the chosen set ALREADY includes → skip that whole stage (it re-appears if the
  // camera changes to one that doesn't include it). MULTI stages (lights/lenses) stay — you may want extras.
  const stageSkipped = (s: any) => {
    const t = STAGE_TYPE[s.key];
    // skip any category the chosen set already covers (monitor, lighting, tripod, mics, ND…) — re-added
    // if the camera changes. Lenses + battery are never skipped (extra glass / spare cells are legit).
    return s.key !== "camera" && s.key !== "lens" && s.key !== "battery" && !!t && includedTypes.has(t);
  };
  const flowStages = stages.filter((s: any) => !stageSkipped(s));
  const onReview = data && stageIdx >= flowStages.length;
  const stage = !onReview ? flowStages[stageIdx] : null;

  // We no longer HIDE incompatible gear — we SHOW it greyed with a reason (the engine already
  // sorted compatible-first), so the customer can see e.g. "this V-mount won't power your FX3".
  const visibleFor = (s: any): any[] => {
    const group = live?.groups[s?.key];
    const options = group?.options ?? [];
    const preferred = group?.preferred;
    const withPreferred = preferred && !options.some((option: any) => option.listingId === preferred.listingId) ? [preferred, ...options] : options;
    if (s?.key === "camera" && s.cameraConstraint) {
      const constraint = cameraConstraintFor(s);
      return [...withPreferred].sort((a: any, b: any) => Number(!matchesAssemblyCamera(a, constraint)) - Number(!matchesAssemblyCamera(b, constraint)));
    }
    return s?.briefConstraint ? [...withPreferred].sort((a: any, b: any) => Number(!matchesAssemblyBrief(a, s.briefConstraint)) - Number(!matchesAssemblyBrief(b, s.briefConstraint))) : withPreferred;
  };
  const skipped = (s: any) => s?.key === "lens" && actionOnly;
  // Why an option is incompatible with the chosen kit (null = fine). Uses the route's per-option
  // verdict for lens/battery, and a client thread check for ND filters.
  const incompatOf = (o: any, s: any): string | null => {
    if (s.key === "lens" && lensFit(o, cams) === "incompatible") return "This lens mount does not fit your selected camera.";
    if (s.key === "battery" && o.specs?.batteryType && camBatts.length && !camBatts.some(b => battOk(b, o.specs.batteryType)))
      return "This battery family does not match your selected camera.";
    if (s.key === "nd-filter" && lensThreads.length && o.specs?.filterThreadMm && lensThreads.every((t: number) => o.specs.filterThreadMm < t))
      return `Ø${o.specs.filterThreadMm}mm — smaller than your lens (needs a step-up ring)`;
    return null;
  };
  const requestReady = selList.length > 0 && selList.every((item:any) => {
    const stage=data?.stages?.find((candidate:any)=>candidate.key===item.stageKey);
    return !!stage && live?.groups?.[stage.key]?.ready === true && item.requestCompatible === true && !incompatOf(item,stage);
  });
  const canAddSelection = !!live && (live.selectionOk === true || requestReady);

  // compatibility warnings for the review — the SAME shared engine the cart + bot use
  // (mount / sensor-coverage / filter-thread / battery / redundant / fixed-lens), so the
  // page can never disagree with /api/compat about what fits.
  const warnings = useMemo(() => {
    const w: { level: string; text: string }[] = [];
    if (cams.length === 0 && data?.stages?.some((s:any)=>s.key==="camera"||s.key==="lens")) w.push({ level: "info", text: "No camera selected yet — add one to anchor your kit." });
    const kit = selList.map((x) => ({ ...x, itemType: typeOf(x) }));
    for (const k of kitWarnings(kit, live?.compatibilityKits)) w.push({ level: k.level, text: k.text });
    return w;
  }, [selList, cams, live?.compatibilityKits]);

  return (
    <>
      <SiteHeader />
      <GearLoopBanner
        eyebrow="AI item assembly"
        lead="Build the perfect"
        accent="kit"
        sub="Tell us the shoot — Gaffer builds a compatible kit, priced for your dates. You approve every item."
      />
      <main className="section-window mx-auto max-w-5xl px-6 pb-32 pt-8">

        {/* ── CONVERSATIONAL ONBOARDING ── */}
        {!data && (
          <section className="mt-8 space-y-3">
            <Ai>Hi! I'm your kit builder. Let's start — what are you shooting?</Ai>
            {intake === 0 ? (
              <Controls>
                {SHOOTS.map((s) => (
                  <button key={s} onClick={() => { setShootType(s); setIntake(1); }} className={chip(false)}>{s}</button>
                ))}
              </Controls>
            ) : (
              <UserMsg>{shootType}</UserMsg>
            )}

            {intake >= 1 && <Ai>Nice — how big is the crew?</Ai>}
            {intake === 1 ? (
              <Controls>
                {SIZES.map((s) => (
                  <button key={s} onClick={() => { setSize(s); setIntake(2); }} className={chip(false)}>{s}</button>
                ))}
              </Controls>
            ) : intake > 1 ? (
              <UserMsg>{size}</UserMsg>
            ) : null}

            {intake >= 2 && <Ai>When do you need the gear?</Ai>}
            {intake === 2 ? (
              <Controls>
                <div className="w-full max-w-[19rem]">
                  <Calendar
                    month={month}
                    onMonthChange={setMonth}
                    start={start || null}
                    end={end || null}
                    unavailable={EMPTY_DATES}
                    onPick={pickDate}
                  />
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <TimeSlotPicker id="assemble-pickup" label="Pickup time" value={pickupTime} onChange={setPickupTime} disabled={!start || !end} />
                    <TimeSlotPicker id="assemble-return" label="Return time" value={returnTime} onChange={setReturnTime} disabled={!start || !end} />
                  </div>
                  <button
                    onClick={() => start && end && pickupTime && returnTime && setIntake(3)}
                    disabled={!start || !end || !pickupTime || !returnTime}
                    className="btn-primary mt-3 w-full py-2.5 text-sm disabled:opacity-40"
                  >
                    {start && end
                      ? `Continue · ${daysInclusive(start, end)} day${daysInclusive(start, end) > 1 ? "s" : ""} →`
                      : "Pick your rental dates and times"}
                  </button>
                </div>
              </Controls>
            ) : intake > 2 ? (
              <UserMsg>{start} {pickupTime} → {end} {returnTime}</UserMsg>
            ) : null}

            {intake >= 3 && <Ai>Last bit — your budget, how many cameras, and anything else I should know?</Ai>}
            {intake >= 3 && (
              <Controls>
                <div className="space-y-4">
                  <div>
                    <label className="flex justify-between text-[11px] text-white/40"><span>Budget</span><span className="font-mono text-sm font-semibold text-accent-300">£{budget}</span></label>
                    <GlowSlider value={budget} onChange={setBudget} className="mt-1.5 w-full" aria-label="Budget" />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-white/40">Cameras</span>
                    <button onClick={() => setCameras((n) => Math.max(1, n - 1))} className="h-8 w-8 rounded-full glass text-white/70">–</button>
                    <span className="w-6 text-center font-display text-white/90">{cameras}</span>
                    <button onClick={() => setCameras((n) => Math.min(6, n + 1))} className="h-8 w-8 rounded-full glass text-white/70">+</button>
                  </div>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. low light, handheld, two presenters…" className="w-full rounded-lg bg-white/[0.06] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30" />
                  <div>
                    <div className="mb-1.5 text-[11px] text-white/40">Mainly need? (we build these out + tailor upsells)</div>
                    <div className="flex flex-wrap gap-1.5">
                      {CATEGORIES.map((cat) => {
                        const on = gearCats.includes(cat);
                        return (
                          <button key={cat} onClick={() => setGearCats((p) => (on ? p.filter((x) => x !== cat) : [...p, cat]))} className={chip(on)}>
                            {cat}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {err && <div className="text-sm text-red-300">{err}</div>}
                  <button onClick={build} disabled={loading} className="btn-primary px-7 py-3">
                    <IconSliders className="h-[18px] w-[18px]" />
                    {loading ? "Designing your kit…" : "Build my kit"}
                  </button>
                </div>
              </Controls>
            )}
            {loading && <TypingIndicator label="designing your kit…" />}
          </section>
        )}

        {/* ── BOT-DRIVEN BUILD THREAD ── */}
        {data && (
          <section className="mt-6 space-y-4">
            <div className="flex flex-wrap items-center gap-1.5 pl-12">
              {flowStages.map((s: any, i: number) => (
                <button
                  key={i}
                  onClick={() => i <= stageIdx && setStageIdx(i)}
                  aria-label={`Step ${i + 1}: ${s.label}`}
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    i === stageIdx && !onReview
                      ? "accent-glow w-9 bg-accent-400"
                      : i < stageIdx || onReview
                        ? "w-4 bg-emerald-400/60 hover:bg-emerald-400"
                        : "w-4 bg-white/15"
                  }`}
                  title={s.label}
                />
              ))}
              <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
                {onReview ? "Review" : `Step ${stageIdx + 1} / ${flowStages.length}`}
              </span>
            </div>

            <Ai mood="talking"><Stream text={data.reply || "Let's build your kit."} /></Ai>
            {!live&&<p role="status" className="pl-12 text-sm text-white/60">Refreshing choices for your basket and current inventory…</p>}

            {flowStages.slice(0, onReview ? flowStages.length : stageIdx + 1).map((s: any, si: number) => {
              const recId = dynRec(s); // dynamic Pick, re-ranked from the current selection
              const dyn = s.key === "lens" || s.key === "battery";
              const opts = dyn ? [...visibleFor(s)].sort((a: any, b: any) => dynScore(b, s.key) - dynScore(a, s.key)) : visibleFor(s);
              const isSkip = skipped(s);
              let stageNote = s.note;
              const cameraRequest = s.key === "camera" && (s.cameraConstraint?.model || s.cameraConstraint?.named || s.cameraConstraint?.strict || s.cameraConstraint?.requiresLens);
              if (live?.groups?.[s.key]?.ready === true && (cameraRequest || s.briefConstraint)) {
                stageNote = recId
                  ? s.key === "lens" && cams.length === 0
                    ? "Your requested lens is available. Choose a compatible camera or verified adapter before pairing it."
                    : "A matching option is available for your selected dates and times."
                  : "No matching option is currently verified for this kit and time. You can choose an alternative.";
              }
              return (
                <div key={si} className="stage-in space-y-2">
                  <div className="msg-left flex items-start gap-3">
                    <BotAvatarBadge mood={si === stageIdx && !onReview ? "talking" : "idle"} size={34} />
                    <div className="rounded-2xl rounded-tl-md border border-white/[0.07] bg-white/[0.045] px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display font-semibold text-white/90">{s.label}</span>
                        {s.upsell && <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-300"><IconBolt className="h-3 w-3" />upgrade</span>}
                      </div>
                      {stageNote && <p className="mt-1 text-sm leading-relaxed text-white/60"><Stream text={stageNote} /></p>}
                      {s.key === "lens" && camIncludesLens && !isSkip && <p className="mt-1 text-xs text-amber-300">Your camera already includes a lens — these are optional additional lenses.</p>}
                      {STAGE_TYPE[s.key] && STAGE_TYPE[s.key] !== "lens" && includedTypes.has(STAGE_TYPE[s.key]) && !isSkip && (
                        <p className="mt-1 text-xs text-amber-300">Your set already includes a {s.label.toLowerCase()} — only add one if you need a spare; the set&apos;s unit is already booked.</p>
                      )}
                    </div>
                  </div>

                  {isSkip ? (
                    <div className="pl-12 text-sm text-white/50">Action camera has a fixed lens — skipping ahead.</div>
                  ) : (
                    <div className="flex gap-3 overflow-x-auto pb-2 pl-12">
                      {[...opts].sort((a: any, b: any) => (a.listingId === recId ? -1 : 0) - (b.listingId === recId ? -1 : 0)).map((o: any, i: number) => {
                        const on = !!sel[o.listingId];
                        const rec = o.listingId === recId;
                        const bad = incompatOf(o, s);
                        const fit = s.key === "lens" ? lensFit(o, cams) : null;
                        const adapter = fit === "adapter";
                        const check = fit === "unknown" ? "Confirm the exact mount and sensor coverage before adding."
                          : fit === "crop" ? "Smaller image circle: expect crop mode or vignetting."
                          : s.key === "gimbal" && !automaticRecommendation(o, contextList.filter(i => i.listingId !== o.listingId), live?.compatibilityKits)
                            ? "Confirm payload, mounting and balance for your selected camera and lenses." : null;
                        return (
                          <button key={o.listingId} onClick={() => toggle(o, s)} disabled={!live||o.needsTimes||!!bad} style={{ animationDelay: `${Math.min(i, 10) * 55}ms` }} className={`card-in lift relative w-40 shrink-0 overflow-hidden rounded-xl border text-left transition-all disabled:opacity-40 ${on ? "border-emerald-400 ring-2 ring-emerald-400/40" : bad ? "border-red-500/30 opacity-55 grayscale hover:opacity-80" : rec ? "border-amber-400/70 ring-2 ring-amber-400/30" : "border-white/10 hover:border-white/25"}`}>
                            {rec && !on && !bad && <span className="absolute left-2 top-2 z-10 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black">Pick</span>}
                            {bad && <span className="absolute left-2 top-2 z-10 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Won't fit</span>}
                            {adapter && !bad && <span className="absolute left-2 top-2 z-10 rounded-full bg-sky-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Adapter</span>}
                            {on && <span className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white"><IconCheck className="h-3 w-3" /></span>}
                            <div className="aspect-[4/3] bg-charcoal-800">
                              <SmartImage fit="contain" src={o.image} fallbackSources={o.imageSources} alt={o.title} className="h-full w-full" />
                            </div>
                            <div className="p-2">
                              <div className="line-clamp-2 text-xs font-medium text-white/85">{o.title}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-white/45">
                                <span>£{o.total} · {o.days}d</span>
                                {!o.needsTimes&&o.available===false&&<span className="rounded bg-amber-300/10 px-1.5 py-0.5 text-amber-200">Unavailable · request only</span>}
                                {o.mount && o.mount !== "any" && o.mount !== "fixed" && (
                                  // non-E camera systems (Blackmagic EF/MFT, Canon RF…) get a blue "other-mount" tag
                                  s.key === "camera" && o.mount !== "E"
                                    ? <span className="rounded bg-sky-500/20 px-1 text-[9px] uppercase text-sky-300">{o.mount} · other</span>
                                    : <span className="rounded bg-white/10 px-1 text-[9px] uppercase text-white/50">{o.mount}</span>
                                )}
                              </div>
                              {bad ? <div className="mt-1 line-clamp-2 text-[10px] leading-snug text-red-300/80">{bad}</div>
                                : adapter ? <div className="mt-1 line-clamp-2 text-[10px] leading-snug text-sky-300/70">{camMounts.length ? `needs a ${o.mount}→${camMounts[0]} adapter` : o.compatReason || "adapter needed"}</div>
                                : check ? <div className="mt-1 text-[10px] leading-snug text-amber-200/80">{check}</div>
                                : o.tip ? <div className="mt-1 line-clamp-2 text-[10px] leading-snug text-white/35">{o.tip}</div> : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {!onReview ? (
              <div className="flex justify-between pl-12">
                <button onClick={() => setStageIdx((i) => Math.max(0, i - 1))} disabled={stageIdx === 0} className="btn-ghost px-5 py-2 text-sm">
                  <IconChevronLeft className="h-4 w-4" /> Back
                </button>
                <button onClick={() => setStageIdx((i) => i + 1)} className="btn-primary px-6 py-2 text-sm">
                  {stageIdx >= flowStages.length - 1 ? "Review kit" : "Next"} <IconArrowRight className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="stage-in space-y-3">
                <Ai mood="talking"><Stream text="Here's your kit — check it over, then add it to your basket." /></Ai>
                <div className="flex flex-col gap-2 pl-12">
                  {selList.length === 0 && <div className="text-sm text-white/40">Nothing selected yet — scroll up and pick some gear.</div>}
                  {selList.map((c) => (
                    <div key={c.listingId} className="flex items-center gap-3 rounded-xl glass p-2">
                      <SmartImage fit="contain" src={c.image} fallbackSources={c.imageSources} alt={c.title} className="h-12 w-12 shrink-0 rounded" />
                      <div className="min-w-0 flex-1"><div className="truncate text-sm text-white/85">{c.title}</div><div className="text-[11px] text-white/40">£{c.total} · {c.stageKey}</div></div>
                      <button onClick={() => setSel((p) => { const n = { ...p }; delete n[c.listingId]; return n; })} className="rounded-full px-3 py-1 text-xs text-white/35 hover:text-red-300">remove</button>
                    </div>
                  ))}
                </div>
                {selList.length > 0 && (
                  <div className="ml-12 rounded-2xl glass p-5">
                    <h3 className="font-display font-semibold text-white/80">Compatibility check</h3>
                    {/* engine-derived from the SELECTED kit (kitWarnings) — never the LLM */}
                    <ul className="mt-3 space-y-1.5 text-sm text-white/55">
                      {warnings.length === 0 ? (
                        <li className="flex gap-2"><IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> Everything in your kit is compatible — mounts, power and filters all check out.</li>
                      ) : (
                        warnings.map((w, i) => <li key={`w${i}`} className="flex gap-2"><span className={w.level === "error" ? "text-red-400" : w.level === "warn" ? "text-amber-400" : "text-white/40"}>!</span> {w.text}</li>)
                      )}
                    </ul>
                  </div>
                )}
                <div className="pl-12"><button onClick={() => setStageIdx(flowStages.length - 1)} className="btn-ghost px-5 py-2 text-sm"><IconChevronLeft className="h-4 w-4" /> Back to gear</button></div>
              </div>
            )}
            <div ref={endRef} />
          </section>
        )}

      </main>

      {/* sticky live budget bar */}
      {data && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-charcoal-900/95 backdrop-blur-xl">
          <div className="mx-auto max-w-5xl px-6 py-3">
            {selList.length > 0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                {selList.map((c) => (
                  <div key={c.listingId} className="flex shrink-0 items-center gap-2 rounded-full bg-white/[0.06] py-1 pl-1 pr-2 ring-1 ring-emerald-400/20">
                    <SmartImage fit="contain" src={c.image} fallbackSources={c.imageSources} alt={c.title} className="h-7 w-7 shrink-0 rounded-full" />
                    <span className="max-w-[130px] truncate text-xs text-white/75">{c.title}</span>
                    <button
                      onClick={() => setSel((p) => { const n = { ...p }; delete n[c.listingId]; return n; })}
                      className="flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-[10px] text-white/50 hover:bg-red-500/40 hover:text-white"
                      aria-label="Remove"
                    >
                      <IconX className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm">
                  <span className="text-white/70">{selList.length} item{selList.length !== 1 ? "s" : ""} · </span>
                  {memberDiscount > 0 && <span className="text-white/35 line-through">£{subtotal} </span>}
                  <span className={overBudget ? "font-semibold text-red-400" : "font-semibold text-emerald-300"}>£{finalTotal}</span>
                  <span className="text-white/35"> / £{budget}{memberDiscount > 0 ? ` · ${tier?.name} −${memberPct}%` : ""}</span>
                  {overBudget && <span className="ml-2 text-red-400">over budget</span>}
                </div>
                <div className={`mt-1 h-1.5 w-56 overflow-hidden rounded-full bg-white/10 ${overBudget ? "budget-over" : ""}`}>
                  <div
                    className={`budget-fill h-full w-full rounded-full ${overBudget ? "bg-red-400" : finalTotal > budget * 0.9 ? "bg-amber-400" : "bg-emerald-400"}`}
                    style={{ transform: `scaleX(${Math.min(1, finalTotal / budget)})` }}
                  />
                </div>
              </div>
              {live?.selectionOk===false&&<p role="status" className="text-sm text-amber-200">Some selected gear is unavailable for this window. You can add it as a request; checkout will show alternatives and keep payment blocked until the full kit passes the stock check.</p>}
              <button onClick={addAll} disabled={selList.length === 0||!canAddSelection} className="btn-primary shrink-0 px-6 py-3">
                {live?.selectionOk===true?`Add ${selList.length || ""} to kit`:"Add request to kit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Ai({ children, mood = "idle" as BotMood }: { children: React.ReactNode; mood?: BotMood }) {
  return (
    <div className="msg-left flex items-end gap-3">
      <BotAvatarBadge mood={mood} size={34} className="mb-0.5" />
      <div className="max-w-[80%] rounded-2xl rounded-bl-md border border-white/[0.07] bg-white/[0.045] px-4 py-2.5 text-sm leading-relaxed text-white/80">
        {children}
      </div>
    </div>
  );
}
function UserMsg({ children }: { children: React.ReactNode }) {
  return (
    <div className="msg-right flex justify-end">
      <div className="rounded-2xl rounded-br-md bg-gradient-to-br from-accent-500 to-accent-600 px-4 py-2 text-sm text-white shadow-[0_6px_20px_-8px_color-mix(in_srgb,var(--color-accent-500)_70%,transparent)]">
        {children}
      </div>
    </div>
  );
}
function Controls({ children }: { children: React.ReactNode }) {
  return <div className="chip-in pl-12">{children}</div>;
}
