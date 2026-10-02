"use client";
import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { prizeDate } from "../../../shared/reviewPrize";
function Entry({ e, token }: { e: any; token: string }) {
  const verify = useMutation(api.reviewPrize.verifySocial),
    judge = useMutation(api.reviewPrize.judge);
  const [note, setNote] = useState(e.verificationNote ?? ""),
    [judgeName, setJudgeName] = useState(e.judgeName ?? ""),
    [independent, setIndependent] = useState(false),
    [scores, setScores] = useState([
      e.originality ?? 0,
      e.craft ?? 0,
      e.clarity ?? 0,
    ]),
    [judgingNote, setJudgingNote] = useState(e.judgingNote ?? ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(f: () => Promise<any>) {
    setBusy(true);
    setError("");
    try {
      await f();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[.02] p-5">
      <div className="flex flex-wrap justify-between gap-2 text-xs">
        <strong>{e.email}</strong>
        <span className="text-amber-200">
          {e.status.replaceAll("_", " ")} · {e.roundKey}
        </span>
      </div>
      <p className="mt-3 text-sm leading-7 text-white/70">{e.story}</p>
      <p className="mt-3 text-xs text-white/45">
        Website review (not a judging score): {e.rating}/5 · {e.review}
      </p>
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-amber-200">
        <a
          href={e.postUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Open @{e.socialHandle} post
        </a>
        <a
          href={e.evidenceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Open private evidence
        </a>
        <span
          className={e.securitySettled ? "text-emerald-300" : "text-red-300"}
        >
          {e.securitySettled
            ? "Security fully settled"
            : "Security changed / not settled"}
        </span>
      </div>
      {e.status !== "winner" && (
        <>
          <label className="mt-4 block text-xs text-white/50">
            Evidence decision: follow, tag, public set story and #ad checked
            <textarea
              minLength={10}
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white"
            />
          </label>
          <div className="mt-2 flex gap-3">
            <button
              disabled={busy}
              onClick={() =>
                run(() => verify({ token, id: e._id, approved: true, note }))
              }
              className="btn-ghost px-3 py-2 text-xs"
            >
              Verify social evidence
            </button>
            <button
              disabled={busy}
              onClick={() =>
                run(() => verify({ token, id: e._id, approved: false, note }))
              }
              className="text-xs text-amber-200"
            >
              Needs evidence / reject
            </button>
          </div>
        </>
      )}
      {e.status === "eligible" &&
        Date.now() > (e.round?.deadline ?? Infinity) && (
          <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
            <input
              aria-label="Independent judge name"
              placeholder="Independent judge full name"
              value={judgeName}
              onChange={(ev) => setJudgeName(ev.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white"
            />
            <label className="flex gap-2 text-xs text-white/60">
              <input
                type="checkbox"
                checked={independent}
                onChange={(ev) => setIndependent(ev.target.checked)}
              />
              This judge is independent of DB Cinema and the entrants
            </label>
            <div className="grid grid-cols-3 gap-2">
              {["Originality / 50", "Craft insight / 30", "Clarity / 20"].map(
                (label, i) => (
                  <label key={label} className="text-[10px] text-white/50">
                    {label}
                    <input
                      type="number"
                      min={0}
                      max={[50, 30, 20][i]}
                      value={scores[i]}
                      onChange={(ev) =>
                        setScores(
                          scores.map((n, j) =>
                            i === j ? Number(ev.target.value) : n,
                          ),
                        )
                      }
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-white"
                    />
                  </label>
                ),
              )}
            </div>
            <textarea
              aria-label="Judging reasons"
              placeholder="Judge’s reasons, independent of praise or rating"
              value={judgingNote}
              onChange={(ev) => setJudgingNote(ev.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white"
            />
            <button
              disabled={busy}
              className="btn-ghost px-3 py-2 text-xs"
              onClick={() =>
                run(() =>
                  judge({
                    token,
                    id: e._id,
                    judgeName,
                    independent,
                    originality: scores[0],
                    craft: scores[1],
                    clarity: scores[2],
                    note: judgingNote,
                  }),
                )
              }
            >
              Save independent judging
            </button>
          </div>
        )}
      {e.judgedAt && (
        <p className="mt-3 text-xs text-emerald-200">
          Judge: {e.judgeName} ·{" "}
          {(e.originality ?? 0) + (e.craft ?? 0) + (e.clarity ?? 0)} / 100 ·{" "}
          {e.judgingNote}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-red-300">
          {error}
        </p>
      )}
    </article>
  );
}
export function StoryPrizeAdmin({ token }: { token: string }) {
  const data = useQuery(api.reviewPrize.adminList, { token });
  const select = useMutation(api.reviewPrize.selectWinner),
    paid = useMutation(api.reviewPrize.recordPaid),
    close = useMutation(api.reviewPrize.closeWithoutWinner);
  const [round, setRound] = useState(""),
    [reference, setReference] = useState(""),
    [error, setError] = useState("");
  const selected =
    data?.rounds.find((r) => r.key === round) ??
    data?.rounds[data.rounds.length - 1];
  const entries =
    data?.entries.filter((e) => e.roundKey === selected?.key) ?? [];
  const best = [...entries]
    .filter((e) => e.status === "eligible" && e.judgedAt && e.securitySettled)
    .sort(
      (a, b) =>
        (b.originality ?? 0) +
          (b.craft ?? 0) +
          (b.clarity ?? 0) -
          ((a.originality ?? 0) + (a.craft ?? 0) + (a.clarity ?? 0)) ||
        (b.originality ?? 0) - (a.originality ?? 0) ||
        a.submittedAt - b.submittedAt,
    )[0];
  async function run(f: () => Promise<any>) {
    setError("");
    try {
      await f();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <section className="mt-8 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">£250 set-story prize</h2>
          <p className="mt-2 text-xs text-white/50">
            Persistent evidence, independent judging and cash-payment tracking.
          </p>
        </div>
        <a
          href="/rental-stories"
          target="_blank"
          className="text-xs text-amber-200 underline"
        >
          Promotion page ↗
        </a>
      </div>
      <select
        aria-label="Prize round"
        value={selected?.key ?? ""}
        onChange={(e) => setRound(e.target.value)}
        className="rounded-xl border border-white/10 bg-[#181818] p-3 text-xs text-white"
      >
        {data?.rounds.map((r) => (
          <option key={r.key}>{r.key}</option>
        ))}
      </select>
      {selected && (
        <div className="rounded-2xl border border-amber-200/15 p-5">
          <div className="grid gap-3 text-xs text-white/60 sm:grid-cols-3">
            <p>
              Deadline
              <br />
              {prizeDate(selected.deadline)}
            </p>
            <p>
              Announcement by
              <br />
              {prizeDate(selected.announceBy)}
            </p>
            <p>
              £250 payment by
              <br />
              {prizeDate(selected.payBy)}
            </p>
          </div>
          <p className="mt-3 text-xs text-amber-200">
            {entries.length} entries ·{" "}
            {entries.filter((e) => e.status === "evidence_pending").length}{" "}
            evidence pending · {entries.filter((e) => e.judgedAt).length} judged
            · {selected.status.replaceAll("_", " ")}
          </p>
          {!selected.winnerEntryId &&
            best &&
            Date.now() > selected.deadline && (
              <button
                className="btn-ghost mt-4 px-4 py-2 text-xs"
                onClick={() =>
                  run(() =>
                    select({ token, roundKey: selected.key, id: best._id }),
                  )
                }
              >
                Confirm top-scoring story as £250 winner
              </button>
            )}
          {!selected.winnerEntryId &&
            Date.now() > selected.deadline &&
            selected.status !== "closed_no_eligible_entries" &&
            !entries.some(
              (e) =>
                e.status === "evidence_pending" ||
                (e.status === "eligible" && e.securitySettled),
            ) && (
              <button
                className="btn-ghost mt-4 px-4 py-2 text-xs"
                onClick={() =>
                  run(() => close({ token, roundKey: selected.key }))
                }
              >
                Close round · no eligible entries
              </button>
            )}
          {selected.winnerEntryId && !selected.paidAt && (
            <div className="mt-4 flex flex-wrap gap-3">
              <input
                aria-label="Actual £250 transfer reference"
                placeholder="Actual £250 transfer reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white"
              />
              <button
                className="btn-ghost px-3 py-2 text-xs"
                onClick={() =>
                  run(() => paid({ token, roundKey: selected.key, reference }))
                }
              >
                Record £250 as paid
              </button>
              <p className="w-full text-[10px] text-white/45">
                Record only after making the actual transfer. This control does
                not send money.
              </p>
            </div>
          )}
          {selected.paidAt && (
            <p className="mt-3 text-xs text-emerald-300">
              £250 payment recorded · {selected.paymentReference}
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      {entries.map((e) => (
        <Entry key={e._id + e.updatedAt} e={e} token={token} />
      ))}
      {!entries.length && (
        <p className="text-sm text-white/45">
          No entries yet. The promotion and next deadline are live.
        </p>
      )}
    </section>
  );
}
