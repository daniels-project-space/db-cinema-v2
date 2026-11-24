"use client";
import {useMutation,useQuery} from "convex/react";
import {useState} from "react";
import {api} from "@cvx/_generated/api";
import {OwnerNotificationBell} from "./OwnerNotificationBell";
import styles from "./NotificationSettings.module.css";
function deliveryLabel(status:string) {
  const labels:Record<string,string>={sent:"Accepted",retry:"Retry needed",queued:"Queued",delivering:"Sending",permanent_failure:"Failed",skipped:"Skipped"};
  return labels[status]??status.replaceAll("_"," ").replace(/\b[a-z]/g,letter=>letter.toUpperCase());
}
export function NotificationSettings({token}:{token:string}) {
  const data=useQuery(api.adminNotifications.settings,{token});
  const save=useMutation(api.adminNotifications.preferences),disable=useMutation(api.adminNotifications.disable),retry=useMutation(api.adminNotifications.retry),retryTelegram=useMutation(api.ownerTelegram.retry);
  const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
  const telegramDeliveries=data?.telegramDeliveries ?? [];
  async function run(key:string,action:()=>Promise<unknown>){if(busy)return;setBusy(key);setError(null);try{await action();}catch(e){setError(e instanceof Error?e.message:"Notification settings could not be updated.");}finally{setBusy(null);}}
  return <section className={styles.root} aria-label="Admin notification settings"><header><div><h2>Notifications</h2><p>Manage phone alerts for your rental team.</p></div><OwnerNotificationBell token={token}/></header>
    {!data?<p role="status">Loading notification settings…</p>:<>
      <div className={styles.status}><span className={data.configured?styles.on:styles.off}>{data.configured?"Push service configured":"Push service not configured"}</span><p>Phone alerts cover messages and essential rental updates. The admin inbox stays available when alerts are off.</p></div>
      <div className={styles.guide}><h3>Set up this phone</h3><p>Open the admin page and enable Phone alerts. On iPhone or iPad, tap Share → Add to Home Screen, open that icon, then enable alerts.</p></div>
      <h3>Team devices</h3><p className={styles.note}>Settings apply separately to each device. {data.moreDevices?"Showing the 50 newest devices.":""}</p>
      {!data.devices.length?<p>No team devices are registered yet.</p>:<div className={styles.devices}>{data.devices.map(device=><form key={device.deviceId} onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void run(device.deviceId,()=>save({token,deviceId:device.deviceId,label:String(form.get("label")),humanRequests:form.has("humanRequests"),renterMessages:form.has("renterMessages")}));}}>
        <div className={styles.deviceHeading}><label>Device name<input name="label" required maxLength={80} defaultValue={device.label} key={device.label}/></label><span className={device.enabled?styles.on:styles.off}>{device.enabled?"Enabled":"Off"}</span></div>
        <label className={styles.toggle}><input name="humanRequests" type="checkbox" defaultChecked={device.humanRequests} key={`human-${device.humanRequests}`}/>Requests to speak with the team</label>
        <label className={styles.toggle}><input name="renterMessages" type="checkbox" defaultChecked={device.renterMessages} key={`message-${device.renterMessages}`}/>New renter messages</label>
        <small>Registered {new Date(device.createdAt).toLocaleDateString("en-GB")}</small>
        {device.lastError&&<p className={styles.error}>{device.lastError}</p>}
        <div className={styles.actions}><button type="submit" disabled={!!busy}>{busy===device.deviceId?"Saving…":"Save preferences"}</button>{device.enabled&&<button type="button" disabled={!!busy} onClick={()=>void run(device.deviceId,()=>disable({token,deviceId:device.deviceId}))}>Disable device</button>}</div>
      </form>)}</div>}
      <h3>Recent delivery attempts</h3><p className={styles.note}>Latest 30 phone alert attempts.</p>
      {!data.deliveries.length?<p>No delivery attempts yet.</p>:<div className={styles.deliveries}>{data.deliveries.map(d=><article key={d._id}><div><strong>{d.title}</strong><span>{d.deviceLabel} · {d.attempts} attempt{d.attempts===1?"":"s"}</span>{d.lastError&&<p className={styles.error}>{d.lastError}</p>}</div><div className={styles.deliveryState}><span>{deliveryLabel(d.status)}</span><small>{new Date(d.updatedAt).toLocaleString("en-GB")}</small>{d.canRetry&&<button type="button" disabled={!!busy} onClick={()=>void run(d._id,()=>retry({token,deliveryId:d._id}))}>{busy===d._id?"Retrying…":"Retry delivery"}</button>}</div></article>)}</div>}
      <h3>Telegram alerts</h3><p className={styles.note}>{data.telegramConfigured?"Telegram is connected.":"Telegram is not connected."} Latest delivery status.</p>
      {!telegramDeliveries.length?<p>No recent Telegram alerts.</p>:<div className={styles.deliveries}>{telegramDeliveries.map(d=><article key={d._id}><div><strong>{d.title}</strong><span>{d.attempts} attempt{d.attempts===1?"":"s"}</span>{d.lastError&&<p className={styles.error}>{d.lastError}</p>}</div><div className={styles.deliveryState}><span>{deliveryLabel(d.status)}</span><small>{new Date(d.createdAt).toLocaleString("en-GB")}</small>{d.canRetry&&<button type="button" disabled={!!busy} onClick={()=>void run(d._id,()=>retryTelegram({token,notificationId:d._id}))}>{busy===d._id?"Retrying…":"Retry delivery"}</button>}</div></article>)}</div>}
    </>}{error&&<p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
