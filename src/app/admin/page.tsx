"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import { ReferralCampaignAdmin } from "@/components/admin/ReferralCampaignAdmin";
import { StoryPrizeAdmin } from "@/components/admin/StoryPrizeAdmin";
import { FilmFundAdmin } from "@/components/admin/FilmFundAdmin";
import { AdminGafferCalls } from "@/components/admin/GafferCalls";
import { RentalInbox } from "@/components/admin/RentalInbox";
import { AdminRentalCards } from "@/components/admin/RentalCards";
import { RentalWorkspace } from "@/components/admin/RentalWorkspace";
import { NotificationSettings } from "@/components/admin/NotificationSettings";
import { OwnerNotificationBell } from "@/components/admin/OwnerNotificationBell";
import { AccountAdmin } from "@/components/admin/AccountAdmin";
import { MarketingListingsAdmin } from "@/components/admin/MarketingListingsAdmin";
import { SmartImage } from "@/components/SmartImage";
import { formatGbp } from "@/lib/pricing";
import { parseOwnerConversationUrl } from "../../../shared/ownerConversationRoute";
import { ManagementShell } from "@/components/management/ManagementShell";
import { AdminInvoiceLibrary } from "@/components/management/AdminInvoiceLibrary";
import { AdminRentalCalendar } from "@/components/management/AdminRentalCalendar";
import { AdminInsights } from "@/components/admin/AdminInsights";
import { AdminDashboard } from "@/components/admin/AdminDashboard";

export default function AdminPage() {
  const [documentsOpen, setDocumentsOpen] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<
    "overview" | "bookings" | "insights" | "inbox" | "settings" | "promotions" | "accounts"
  >("overview");
  const [inboxSection, setInboxSection] = useState<"conversations" | "enquiries">("conversations");
  const [promotionSection, setPromotionSection] = useState<"campaigns" | "fund" | "stories">("campaigns");
  const [customerSection, setCustomerSection] = useState<"customers" | "invoices">("customers");
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [supportAccountId, setSupportAccountId] = useState<string | null>(null);
  const [conversationNavigation, setConversationNavigation] = useState(0);
  const [rentalAction,setRentalAction]=useState<"change"|"dates"|"discount"|"refund"|undefined>(undefined);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    setToken(localStorage.getItem("dbc_admin"));
    const open = (href: string) => {
      const url=new URL(href,window.location.origin);
      const rental=url.searchParams.get("rental");
      if(url.origin===window.location.origin && rental && /^[a-zA-Z0-9_-]{8,100}$/.test(rental)){
        const action=url.searchParams.get("action");
        setRentalAction(["change","dates","discount","refund"].includes(action??"")?action as "change"|"dates"|"discount"|"refund":undefined);
        setDetailId(rental);setTab("bookings");return;
      }
      const route = parseOwnerConversationUrl(href, window.location.origin);
      if (!route?.openMessages) return;
      setConversationId(route.bookingId);
      setSupportAccountId(route.accountId);
      setConversationNavigation(value => value + 1);
      setDetailId(null);
      setInboxSection("conversations");setTab("inbox");
    };
    const fromLocation = () => { if (["#marketing", "#settings"].includes(window.location.hash)) setTab("settings"); else if (window.location.hash === "#invoices") {setCustomerSection("invoices");setTab("accounts");} else if (["#fund", "#stories", "#promotions"].includes(window.location.hash)) {setPromotionSection(window.location.hash === "#fund" ? "fund" : window.location.hash === "#stories" ? "stories" : "campaigns");setTab("promotions");} else if(window.location.hash === "#calendar") {setCalendarExpanded(true);setTab("overview");} else if(window.location.hash === "#reports") setTab("overview"); else if(window.location.hash === "#enquiries") {setInboxSection("enquiries");setTab("inbox");} else open(window.location.href); };
    const fromPush = (event: MessageEvent) => {
      if (event.data?.type !== "dbc:open-owner-conversation" || typeof event.data.url !== "string") return;
      const route = parseOwnerConversationUrl(event.data.url, window.location.origin);
      if (!route?.openMessages) return;
      window.history.replaceState(null, "", route.href);
      open(route.href);
    };
    fromLocation();
    window.addEventListener("hashchange", fromLocation);
    window.addEventListener("popstate", fromLocation);
    navigator.serviceWorker?.addEventListener("message", fromPush);
    return () => {
      window.removeEventListener("hashchange", fromLocation);
      window.removeEventListener("popstate", fromLocation);
      navigator.serviceWorker?.removeEventListener("message", fromPush);
    };
  }, []);

  const authed=useQuery(api.bookings.adminAuthorized,token?{token}:"skip");
  const rentalUnread =
    useQuery(
      api.rentalChat.unreadTotals,
      token ? { token, admin: true } : "skip",
    ) ?? 0;
  const contacts = useQuery(api.contact.adminList, token ? { token } : "skip");
  const attention = useQuery(api.adminNotifications.latest, token ? { token } : "skip") ?? [];
  const markHandled = useMutation(api.contact.adminMarkHandled);


  function save() {
    localStorage.setItem("dbc_admin", input);
    setToken(input);
  }
  function lock() {
    localStorage.removeItem("dbc_admin");
    setToken(null);
    setInput("");
  }

  if (!token || authed === false) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-sm px-6 py-24">
          <h1 className="font-display text-2xl font-bold text-white/90">
            Admin
          </h1>
          <p className="mt-2 text-sm text-white/40">
            Enter the admin passcode.
          </p>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Passcode"
            className="mt-4 w-full rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none"
          />
          <button
            onClick={save}
            className="mt-3 w-full rounded-full bg-accent-500 py-2.5 font-medium text-white hover:bg-accent-600"
          >
            Enter
          </button>
          {authed === false && (
            <p className="mt-3 text-center text-xs text-red-300">
              Wrong passcode.
            </p>
          )}
        </main>
      </>
    );
  }

  return (
    <ManagementShell screenOverride={tab === "accounts" && documentsOpen ? "documents" : undefined} breadcrumb={tab === "accounts" && documentsOpen ? <><span>Customers</span><i>/</i><strong>{documentsOpen}</strong></> : undefined} role="admin" name="DB Cinema team" title={tab === "accounts" && documentsOpen ? "Documents & verification" : { overview: "Dashboard", bookings: "Rentals", insights: "Insights & Demand", inbox: "Messages & enquiries", accounts: "Customers & members", promotions: "Promotional actions", settings: "Settings" }[tab]} subtitle={tab === "accounts" && documentsOpen ? "Securely saved documents linked to this customer and their rentals." : "Manage rentals, accounts and equipment operations."}
      active={tab} nav={[
        { key: "overview", label: "Dashboard", icon: "dashboard" },
        { key: "bookings", label: "Rentals", icon: "rentals" },
        { key: "accounts", label: "Customers & members", icon: "people" },
        { key: "inbox", label: "Messages & enquiries", icon: "messages", badge: rentalUnread + (contacts?.items.filter(m => !m.handled).length ?? 0) },
        { key: "insights", label: "Insights", icon: "reports" },
        { key: "promotions", label: "Promotional actions", icon: "people" },
        { key: "settings", label: "Settings", icon: "settings" },
      ]} onNavigate={key => {setDocumentsOpen(null);setTab(key as typeof tab);window.history.replaceState(null, "", window.location.pathname);}}

      actions={<><OwnerNotificationBell token={token} /><button onClick={lock} className="rounded-lg border border-white/15 px-3 py-2 text-[10px] text-white/65">Lock</button></>}>

        {tab === "overview" && (
          <div>
            <AdminDashboard token={token} unread={rentalUnread} alerts={attention.length}
              onRental={id => { setDetailId(id); setTab("bookings"); }} onRentals={() => setTab("bookings")}
              onCalendar={() => {setCalendarExpanded(value => !value);}} onMessages={() => setTab("inbox")} onReports={() => setTab("insights")} onInventory={() => setTab("settings")} />
            {calendarExpanded && <section className="admin-tool-panel" aria-label="Detailed rental calendar"><header><h2>Rental calendar</h2><button onClick={() => setCalendarExpanded(false)}>Close calendar ×</button></header><AdminRentalCalendar token={token}/></section>}
            <section className="admin-tool-panel" aria-label="Gaffer calls"><AdminGafferCalls token={token}/></section>
          </div>
        )}

        {tab === "inbox" && <div className="admin-section-tabs" role="group" aria-label="Messages sections"><button aria-pressed={inboxSection === "conversations"} onClick={() => setInboxSection("conversations")}>Conversations {rentalUnread > 0 ? `(${rentalUnread})` : ""}</button><button aria-pressed={inboxSection === "enquiries"} onClick={() => setInboxSection("enquiries")}>Enquiries ({contacts?.items.filter(m => !m.handled).length ?? 0} pending)</button></div>}
        {tab === "inbox" && inboxSection === "conversations" && <RentalInbox token={token} focusBookingId={conversationId} focusAccountId={supportAccountId} focusRevision={conversationNavigation} />}
        {tab === "insights" && <AdminInsights token={token} onInventory={() => setTab("settings")} />}



        {tab === "bookings" && !detailId && (
          <AdminRentalCards
            token={token}
            onChat={(id) => {
              setConversationId(id);
              setSupportAccountId(null);
              setInboxSection("conversations");setTab("inbox");
            }}
            onDetails={setDetailId}
          />
        )}
        {tab === "bookings" && detailId && (
          <RentalWorkspace
            key={detailId}
            token={token}
            bookingId={detailId}
            initialAction={rentalAction}
            onClose={() => setDetailId(null)}
            onChat={() => {
              setConversationId(detailId);
              setSupportAccountId(null);
              setInboxSection("conversations");setTab("inbox");
            }}
          />
        )}

        {tab === "inbox" && inboxSection === "enquiries" && (
          <div className="mt-6 grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {contacts?.items.map((m: any) => (
              <div
                key={m._id}
                className={`rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs ${m.handled ? "opacity-45" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] text-white/80">
                    {m.name} <span className="text-white/35">· {m.email}</span>
                  </span>
                  {!m.handled && (
                    <button
                      onClick={() => markHandled({ token, id: m._id })}
                      className="shrink-0 text-[11px] text-accent-400 hover:underline"
                    >
                      handled
                    </button>
                  )}
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer list-none text-xs leading-6 text-white/60"><span className="line-clamp-2">{m.message}</span><span className="mt-2 block text-[10px] text-accent-300">Open enquiry ↗</span></summary>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-white/75">{m.message}</p>
                  <a href={`mailto:${m.email}`} className="mt-3 inline-block rounded-full bg-white/[0.06] px-4 py-2 text-xs text-white/75">Reply by email ↗</a>
                </details>
              </div>
            ))}
            {contacts && contacts.items.length === 0 && (
              <div className="text-sm text-white/30">No messages.</div>
            )}
          </div>
        )}

        {tab === "promotions" && <div className="admin-section-tabs" role="group" aria-label="Promotional actions"><button aria-pressed={promotionSection === "campaigns"} onClick={() => setPromotionSection("campaigns")}>Campaigns & referrals</button><button aria-pressed={promotionSection === "fund"} onClick={() => setPromotionSection("fund")}>Film Fund</button><button aria-pressed={promotionSection === "stories"} onClick={() => setPromotionSection("stories")}>Story Prize</button></div>}
        {tab === "promotions" && promotionSection === "fund" && <FilmFundAdmin token={token}/>}
        {tab === "promotions" && promotionSection === "campaigns" && <div className="admin-tool-panel"><AdminPromos token={token}/><ReferralCampaignAdmin token={token}/></div>}
        {tab === "accounts" && !documentsOpen && <div className="admin-section-tabs" role="group" aria-label="Customer pages"><button aria-pressed={customerSection === "customers"} onClick={() => setCustomerSection("customers")}>Customers & members</button><button aria-pressed={customerSection === "invoices"} onClick={() => setCustomerSection("invoices")}>Invoices & PDFs</button></div>}
        {tab === "accounts" && customerSection === "invoices" && <AdminInvoiceLibrary token={token}/>}
        {tab === "accounts" && customerSection === "customers" && <AccountAdmin token={token} onDocumentsChange={setDocumentsOpen} onRental={id => { setDetailId(id); setTab("bookings"); }} onConversation={(accountId, bookingId) => { setConversationId(bookingId); setSupportAccountId(bookingId ? null : accountId); setConversationNavigation(v => v + 1); setInboxSection("conversations");setTab("inbox"); }} />}

        {tab === "promotions" && promotionSection === "stories" && <StoryPrizeAdmin token={token}/>}


        {tab === "settings" && (
          <div className="mt-6 space-y-4">
            <NotificationSettings token={token} />
            <MarketingListingsAdmin token={token} />
            <AdminSettings token={token} />
            {[
              ["Community", <AdminCollective key="collective" token={token} />],

            ].map(([label, content]) => (
              <details
                key={String(label)}
                className="rounded-3xl border border-white/[0.07] bg-[#141414] p-5"
              >
                <summary className="cursor-pointer text-sm text-white/75">
                  {label}
                </summary>
                {content}
              </details>
            ))}
          </div>
        )}
    </ManagementShell>
  );
}

function AdminSettings({ token }: { token: string }) {
  const res = useQuery(api.settings.adminGet, { token });
  const update = useMutation(api.settings.adminUpdate);
  const [f, setF] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (res && (res as any).authorized) setF((res as any).config);
  }, [res]);
  if (!res || !(res as any).authorized || !f) return null;

  const field =
    "w-full rounded-xl bg-white/[0.04] px-4 py-3 text-sm text-white/80 outline-none";
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await update({
        token,
        deliveryMarginPct: Number(f.deliveryMarginPct),
        deliveryMaxKm: Number(f.deliveryMaxKm),
        openingHours: f.openingHours,
        acceptingOrders: f.acceptingOrders,
        googleReviewUrl: f.googleReviewUrl ?? "",
        businessAddress: f.businessAddress ?? "",
        businessPhone: f.businessPhone ?? "",
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e.message ?? "Settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-2">
      <h2 className="font-display text-lg font-semibold text-white/80">
        Settings
      </h2>
      <div className="mt-4 grid gap-5 rounded-3xl border border-white/[0.07] bg-[#141414] p-6 sm:grid-cols-2 text-sm">
        <label className="flex flex-col gap-2 text-xs text-white/50">
          Delivery margin %
          <input
            className={field}
            type="number"
            value={f.deliveryMarginPct}
            onChange={(e) => setF({ ...f, deliveryMarginPct: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-2 text-xs text-white/50">
          Max delivery distance (km)
          <input
            className={field}
            type="number"
            value={f.deliveryMaxKm}
            onChange={(e) => setF({ ...f, deliveryMaxKm: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-2 text-xs text-white/50">
          Opening hours
          <input
            className={field}
            value={f.openingHours}
            onChange={(e) => setF({ ...f, openingHours: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-2 text-xs text-white/50">
          Accepting orders
          <input
            type="checkbox"
            className="accent-accent-500 h-4 w-4"
            checked={f.acceptingOrders}
            onChange={(e) => setF({ ...f, acceptingOrders: e.target.checked })}
          />
        </label>
        <label className="flex flex-col gap-2 text-xs text-white/50">
          Google review link
          <input
            className={field}
            placeholder="https://g.page/r/…/review"
            value={f.googleReviewUrl ?? ""}
            onChange={(e) => setF({ ...f, googleReviewUrl: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-2 text-xs text-white/50">
          Business address
          <input
            className={field}
            placeholder="123 Example St, London"
            value={f.businessAddress ?? ""}
            onChange={(e) => setF({ ...f, businessAddress: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-2 text-xs text-white/50">
          Business phone
          <input
            className={field}
            placeholder="+44 20 …"
            value={f.businessPhone ?? ""}
            onChange={(e) => setF({ ...f, businessPhone: e.target.value })}
          />
        </label>
        {error && (
          <p role="alert" className="text-xs text-rose-300 sm:col-span-2">
            {error}
          </p>
        )}
        <button
          disabled={busy}
          onClick={save}
          className="w-fit rounded-full bg-accent-500 px-5 py-2 text-sm font-medium text-white hover:bg-accent-600"
        >
          {busy ? "Saving…" : saved ? "Saved" : "Save settings"}
        </button>
      </div>
    </section>
  );
}

function AdminPromos({ token }: { token: string }) {
  const res = useQuery(api.promo.adminList, { token });
  const create = useMutation(api.promo.adminCreate);
  const toggle = useMutation(api.promo.adminToggle);
  const [code, setCode] = useState("");
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("15");
  const [err, setErr] = useState<string | null>(null);
  if (!res || !(res as any).authorized) return null;

  async function add() {
    setErr(null);
    try {
      await create({ token, code, type, value: Number(value) });
      setCode("");
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    }
  }
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold text-white/80">
        Promo codes
      </h2>
      <div className="mt-3 flex flex-col gap-2">
        {(res as any).items.map((p: any) => (
          <div
            key={p._id}
            className="flex items-center justify-between rounded-xl glass px-4 py-2 text-sm"
          >
            <span className="font-mono uppercase text-white/80">{p.code}</span>
            <span className="text-white/50">
              {p.type === "percent" ? `${p.value}%` : `£${p.value}`} · used{" "}
              {p.usedCount}
            </span>
            <button
              onClick={() => toggle({ token, id: p._id })}
              className={`rounded-full px-3 py-1 text-xs ${p.active ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/40"}`}
            >
              {p.active ? "active" : "inactive"}
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-2xl glass p-4">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="CODE"
          className="rounded-lg bg-white/[0.04] px-3 py-2 text-sm uppercase text-white/80 outline-none"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as any)}
          className="rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none [color-scheme:dark]"
        >
          <option value="percent">%</option>
          <option value="fixed">£</option>
        </select>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          type="number"
          className="w-20 rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none"
        />
        <button
          onClick={add}
          className="rounded-full bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600"
        >
          Add code
        </button>
        {err && <span className="text-xs text-red-300">{err}</span>}
      </div>
    </section>
  );
}

function AdminCollective({ token }: { token: string }) {
  const res = useQuery(api.collective.adminList, { token });
  const review = useMutation(api.collective.review);
  const setIdVerified = useMutation(api.collective.setIdVerified);
  const setActive = useMutation(api.collective.setActive);
  const [busy, setBusy] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>(null);
  if (!res || !(res as any).authorized) return null;
  const items = (res as any).items as any[];
  const pending = items.filter((i) => i.status === "pending").length;

  function startEdit(a: any) {
    setEditId(a._id);
    setEdit({
      roleLabel: a.roleLabel ?? "",
      firstName: a.firstName ?? "",
      years: a.years ?? "",
      age: a.age ?? "",
      tagline: a.tagline ?? "",
      skills: (a.skills ?? []).join(", "),
      rateHourly: a.rateHourly ?? "",
      rateHalfDay: a.rateHalfDay ?? "",
      rateDay: a.rateDay ?? "",
    });
  }
  const numOpt = (v: any) => (String(v).trim() ? Number(v) : undefined);

  async function act(a: any, action: "approve" | "reject", withEdits: boolean) {
    setBusy(a._id + action);
    try {
      const edits =
        withEdits && edit
          ? {
              roleLabel: edit.roleLabel || undefined,
              firstName: edit.firstName || undefined,
              years: numOpt(edit.years),
              age: numOpt(edit.age),
              tagline: edit.tagline || undefined,
              skills: edit.skills
                ? edit.skills
                    .split(",")
                    .map((s: string) => s.trim())
                    .filter(Boolean)
                : undefined,
              rateHourly: numOpt(edit.rateHourly),
              rateHalfDay: numOpt(edit.rateHalfDay),
              rateDay: numOpt(edit.rateDay),
            }
          : undefined;
      await review({ token, id: a._id, action, edits });
      setEditId(null);
      setEdit(null);
    } catch (e: any) {
      alert(e?.message ?? "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(a: any) {
    // grantActive predates this feature for old approvals — undefined reads as active
    const currentlyActive = a.grantActive !== false;
    setBusy(a._id + "active");
    try {
      await setActive({ token, id: a._id, active: !currentlyActive });
    } catch (e: any) {
      alert(e?.message ?? "Failed");
    } finally {
      setBusy(null);
    }
  }

  const ei =
    "rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/80 outline-none";

  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold text-white/80">
        Creative Collective{" "}
        <span className="text-white/40">({pending} pending)</span>
      </h2>
      <div className="mt-3 flex flex-col gap-3">
        {items.length === 0 && (
          <div className="text-sm text-white/30">No applications yet.</div>
        )}
        {items.map((a) => (
          <div
            key={a._id}
            className={`rounded-2xl glass p-4 ${a.status !== "pending" ? "opacity-60" : ""}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <span
                  className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                    a.kind === "gear-provider"
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-accent-500/20 text-accent-300"
                  }`}
                >
                  {a.kind === "gear-provider"
                    ? "Gear provider"
                    : "Professional"}
                </span>
                <span className="ml-2 text-sm text-white/80">{a.fullName}</span>
                <span className="ml-2 text-xs text-white/40">
                  {a.email}
                  {a.phone ? ` · ${a.phone}` : ""}
                </span>
              </div>
              <span
                className={`rounded px-2 py-0.5 text-[10px] uppercase ${
                  a.status === "pending"
                    ? "bg-white/10 text-white/60"
                    : a.status === "approved"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-red-500/20 text-red-300"
                }`}
              >
                {a.status}
              </span>
            </div>

            <div className="mt-2 text-xs leading-relaxed text-white/50">
              {a.kind === "professional" ? (
                <>
                  <div>
                    <b className="text-white/70">{a.roleLabel || a.role}</b> ·{" "}
                    {a.firstName} · {a.age ? `${a.age} · ` : ""}
                    {a.years ?? "?"}y
                  </div>
                  {a.tagline && <div className="mt-1">{a.tagline}</div>}
                  {a.skills?.length > 0 && (
                    <div className="mt-1">Skills: {a.skills.join(", ")}</div>
                  )}
                  <div className="mt-1">
                    Rates: hr {a.rateHourly ?? "—"} / half{" "}
                    {a.rateHalfDay ?? "—"} / day {a.rateDay ?? "—"}
                  </div>
                  {a.portfolio && (
                    <div className="mt-1">Portfolio: {a.portfolio}</div>
                  )}
                </>
              ) : (
                <>
                  <div>Gear: {a.gearList}</div>
                  {a.gearValue && (
                    <div className="mt-1">Approx value: {a.gearValue}</div>
                  )}
                  <div className="mt-1">
                    Terms:{" "}
                    {a.agreementAccepted
                      ? "✓ 60/40 + custody accepted"
                      : "✗ not accepted"}
                  </div>
                </>
              )}
              {a.notes && (
                <div className="mt-1 text-white/40">Notes: {a.notes}</div>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className={
                    a.termsAgreed ? "text-emerald-300" : "text-red-300"
                  }
                >
                  {a.termsAgreed ? "✓ terms agreed" : "✗ terms"}
                </span>
                <span className="text-white/20">·</span>
                <span
                  className={
                    a.bankProvided ? "text-emerald-300" : "text-amber-300"
                  }
                >
                  {a.bankProvided
                    ? `bank ${a.bankSortCode ?? ""} ••${(a.bankAccountNumber ?? "").slice(-4)}`
                    : "no bank yet"}
                </span>
                <span className="text-white/20">·</span>
                <span
                  className={
                    a.idStatus === "verified"
                      ? "text-emerald-300"
                      : a.idStatus === "submitted"
                        ? "text-amber-300"
                        : "text-white/40"
                  }
                >
                  ID: {a.idStatus ?? "none"}
                </span>
                {a.idUrl && (
                  <a
                    href={a.idUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-300 hover:underline"
                  >
                    view ID
                  </a>
                )}
                {a.idStatus === "submitted" && (
                  <button
                    onClick={() =>
                      setIdVerified({ token, id: a._id, verified: true })
                    }
                    className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-300 hover:bg-emerald-500/30"
                  >
                    mark ID verified
                  </button>
                )}
              </div>
            </div>

            {/* inline edit (professionals) */}
            {editId === a._id && a.kind === "professional" && (
              <div className="mt-3 grid gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-2">
                <input
                  className={ei}
                  value={edit.roleLabel}
                  onChange={(e) =>
                    setEdit({ ...edit, roleLabel: e.target.value })
                  }
                  placeholder="Role label"
                />
                <input
                  className={ei}
                  value={edit.firstName}
                  onChange={(e) =>
                    setEdit({ ...edit, firstName: e.target.value })
                  }
                  placeholder="Display name"
                />
                <input
                  className={`${ei} sm:col-span-2`}
                  value={edit.tagline}
                  onChange={(e) =>
                    setEdit({ ...edit, tagline: e.target.value })
                  }
                  placeholder="Tagline"
                />
                <input
                  className={`${ei} sm:col-span-2`}
                  value={edit.skills}
                  onChange={(e) => setEdit({ ...edit, skills: e.target.value })}
                  placeholder="Skills (comma separated)"
                />
                <input
                  className={ei}
                  type="number"
                  value={edit.years}
                  onChange={(e) => setEdit({ ...edit, years: e.target.value })}
                  placeholder="Years"
                />
                <input
                  className={ei}
                  type="number"
                  value={edit.age}
                  onChange={(e) => setEdit({ ...edit, age: e.target.value })}
                  placeholder="Age"
                />
                <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                  <input
                    className={ei}
                    type="number"
                    value={edit.rateHourly}
                    onChange={(e) =>
                      setEdit({ ...edit, rateHourly: e.target.value })
                    }
                    placeholder="Hourly"
                  />
                  <input
                    className={ei}
                    type="number"
                    value={edit.rateHalfDay}
                    onChange={(e) =>
                      setEdit({ ...edit, rateHalfDay: e.target.value })
                    }
                    placeholder="Half"
                  />
                  <input
                    className={ei}
                    type="number"
                    value={edit.rateDay}
                    onChange={(e) =>
                      setEdit({ ...edit, rateDay: e.target.value })
                    }
                    placeholder="Day"
                  />
                </div>
              </div>
            )}

            {a.status === "pending" && (
              <div className="mt-3 flex flex-wrap gap-2">
                {editId === a._id ? (
                  <>
                    <button
                      onClick={() => act(a, "approve", true)}
                      disabled={busy === a._id + "approve"}
                      className="rounded-full bg-emerald-500/20 px-4 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40"
                    >
                      Save edits &amp; publish
                    </button>
                    <button
                      onClick={() => {
                        setEditId(null);
                        setEdit(null);
                      }}
                      className="rounded-full glass px-4 py-1.5 text-xs text-white/60 hover:text-white"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => act(a, "approve", false)}
                      disabled={busy === a._id + "approve"}
                      className="rounded-full bg-emerald-500/20 px-4 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40"
                    >
                      {a.kind === "professional"
                        ? "Approve & publish"
                        : "Approve"}
                    </button>
                    {a.kind === "professional" && (
                      <button
                        onClick={() => startEdit(a)}
                        className="rounded-full glass px-4 py-1.5 text-xs text-white/70 hover:text-white"
                      >
                        Edit & publish
                      </button>
                    )}
                    <button
                      onClick={() => act(a, "reject", false)}
                      disabled={busy === a._id + "reject"}
                      className="rounded-full bg-red-500/15 px-4 py-1.5 text-xs text-red-300 hover:bg-red-500/25 disabled:opacity-40"
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            )}

            {a.status === "approved" && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => toggleActive(a)}
                  disabled={busy === a._id + "active"}
                  className={`rounded-full px-4 py-1.5 text-xs disabled:opacity-40 ${
                    a.grantActive !== false
                      ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                      : "bg-red-500/15 text-red-300 hover:bg-red-500/25"
                  }`}
                >
                  {a.grantActive !== false
                    ? "Active — deactivate"
                    : "Inactive — reactivate"}
                </button>
                {a.kind === "gear-provider" && (
                  <span className="text-[11px] text-white/30">
                    Only affects their free membership perk — not linked to any
                    live listings.
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-white/30">
        Approving a professional publishes a first-name-only crew card on /gear.
        Gear-provider approvals are marked approved — onboard the items into the
        catalogue separately.
      </p>
    </section>
  );
}
