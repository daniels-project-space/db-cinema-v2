"use client";

import { useEffect, useState } from "react";
import styles from "./SearchConsoleInsights.module.css";

type MetricRow = { name: string; clicks: number; impressions: number; ctr: number; position: number };
type Report = {
  status: "connected";
  property: string;
  range: { startDate: string; endDate: string };
  summary: Omit<MetricRow, "name">;
  series: Array<{ date: string; clicks: number; impressions: number; ctr: number; position: number }>;
  topQueries: MetricRow[];
  topPages: MetricRow[];
};
type LoadState = { kind: "loading" } | { kind: "not_configured" } | { kind: "error"; reason: string } | { kind: "ready"; report: Report };

const reasonText: Record<string, string> = {
  google_auth_failed: "Google rejected the read-only credentials. Check the OAuth client and refresh token.",
  google_auth_unavailable: "Google’s authentication service could not be reached. Try again shortly.",
  google_property_forbidden: "This Google account does not have access to the configured Search Console property.",
  google_rate_limited: "Google temporarily limited requests. Try again in a few minutes.",
  google_search_unavailable: "Google Search Console could not return the report. Try again shortly.",
};

function count(value: number) {
  return Math.round(value).toLocaleString("en-GB");
}

function percent(value: number) {
  return `${(value * 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;
}

function position(value: number) {
  return value > 0 ? value.toLocaleString("en-GB", { maximumFractionDigits: 1 }) : "—";
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>;
}

function Ranking({ title, rows, empty }: { title: string; rows: MetricRow[]; empty: string }) {
  return <section className={styles.ranking}>
    <h3>{title}</h3>
    {rows.length ? <ol>{rows.map(row => <li key={row.name}>
      <span title={row.name}>{row.name}</span><strong>{count(row.clicks)} clicks</strong>
      <small>{count(row.impressions)} impressions · {percent(row.ctr)} CTR · position {position(row.position)}</small>
    </li>)}</ol> : <p className={styles.empty}>{empty}</p>}
  </section>;
}

export function SearchConsoleInsights({ token, days }: { token: string; days: number }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch("/api/admin/search-console", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, days }),
      cache: "no-store",
      signal: controller.signal,
    }).then(async response => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.reason ?? "google_search_unavailable");
      if (result.status === "not_configured") return { kind: "not_configured" } as const;
      if (result.status !== "connected") throw new Error(result.reason ?? "google_search_unavailable");
      return { kind: "ready", report: result as Report } as const;
    }).then(setState).catch(error => {
      if (error?.name !== "AbortError") setState({ kind: "error", reason: error instanceof Error ? error.message : "google_search_unavailable" });
    });
    return () => controller.abort();
  }, [token, days, retry]);

  return <section className={styles.panel} aria-label="Google Search Console performance">
    <header className={styles.heading}><div><h2>Google Search Console</h2><p>Real Google web-search performance · separate from on-site visits.</p></div>
      <button type="button" onClick={() => setRetry(value => value + 1)} disabled={state.kind === "loading"}>{state.kind === "loading" ? "Refreshing…" : "Refresh"}</button>
    </header>
    {state.kind === "loading" && <p className={styles.message} aria-busy="true">Loading Search Console data…</p>}
    {state.kind === "not_configured" && <p className={styles.message} role="status">Not connected yet. Add the read-only Search Console OAuth credentials to this site’s secure Vercel settings. No sample or estimated figures are shown.</p>}
    {state.kind === "error" && <p className={styles.message} role="alert">{reasonText[state.reason] ?? "Could not load Search Console data."}</p>}
    {state.kind === "ready" && <>
      <p className={styles.dateRange}>{state.report.property} · {state.report.range.startDate} to {state.report.range.endDate} (Pacific Time) · Google’s finalized data is normally delayed 2–3 days.</p>
      <div className={styles.metrics}>
        <Metric label="Google search clicks" value={count(state.report.summary.clicks)} />
        <Metric label="Impressions" value={count(state.report.summary.impressions)} />
        <Metric label="Click-through rate" value={percent(state.report.summary.ctr)} />
        <Metric label="Average position" value={position(state.report.summary.position)} />
      </div>
      <div className={styles.rankings}>
        <Ranking title="Top search queries" rows={state.report.topQueries} empty="No query rows in this period. Google withholds some low-volume queries for privacy." />
        <Ranking title="Top landing pages from Google" rows={state.report.topPages} empty="No pages recorded in this period." />
      </div>
    </>}
    <p className={styles.crawlers}><strong>Crawlers are separate:</strong> Search Console clicks are not crawler requests or page views. Bot and automated-browser sessions are excluded from the site’s first-party activity figures; crawler request counts are not currently connected to this panel.</p>
  </section>;
}
