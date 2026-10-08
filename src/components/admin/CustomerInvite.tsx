"use client";
import { useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import styles from "./AccountAdmin.module.css";

/** The account is created only after the recipient verifies their email. */
export function CustomerInvite() {
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const request = useAction(api.accountCodes.request);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const close = () => { generation.current++; dialog.current?.close(); setBusy(false); };
  return <>
    <button type="button" className={styles.addCustomer} onClick={() => { generation.current++; setMessage(""); setBusy(false); dialog.current?.showModal(); }}>Add customer</button>
    <dialog ref={dialog} className={styles.invite} onCancel={close}>
      <header><h2>Add customer</h2><button type="button" aria-label="Close customer invitation" onClick={close}>×</button></header>
      <p>Send a secure setup code. The customer verifies their email and chooses a password to create their account.</p>
      <form onSubmit={async e => {
        e.preventDefault(); const form = e.currentTarget; const data = new FormData(form); const current = ++generation.current;
        setBusy(true); setMessage("");
        try {
          await request({ purpose: "setup", name: String(data.get("name")).trim(), phone: String(data.get("phone")).trim(), email: String(data.get("email")).trim() });
          if (generation.current === current) { setMessage("Setup requested. Ask the customer to check their email for the code and complete account setup."); form.reset(); }
        } catch { if (generation.current === current) setMessage("The setup request could not be completed. Please try again."); }
        finally { if (generation.current === current) setBusy(false); }
      }}>
        <label>Name<input name="name" required maxLength={160} autoComplete="name" disabled={busy} /></label>
        <label>Phone<input name="phone" type="tel" required maxLength={40} autoComplete="tel" disabled={busy} /></label>
        <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" disabled={busy} /></label>
        {message && <p role="status">{message}</p>}
        <button type="submit" className={styles.addCustomer} disabled={busy}>{busy ? "Requesting setup…" : "Send setup code"}</button>
      </form>
    </dialog>
  </>;
}
