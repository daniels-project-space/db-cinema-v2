"use client";
import {useMutation,useQuery} from "convex/react";
import {useState} from "react";
import {api} from "@cvx/_generated/api";
import {OwnerNotificationBell} from "./OwnerNotificationBell";
import styles from "./NotificationSettings.module.css";
export function NotificationSettings({token}:{token:string}) {
  const data=useQuery(api.adminNotifications.settings,{token});
  const save=useMutation(api.adminNotifications.preferences),disable=useMutation(api.adminNotifications.disable),retry=useMutation(api.adminNotifications.retry);
  const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
  async function run(key:string,action:()=>Promise<unknown>){if(busy)return;setBusy(key);setError(null);try{await action();}catch(e){setError(e instanceof Error?e.message:"Notification settings could not be updated.");}finally{setBusy(null);}}
  return <section className={styles.root} aria-label="Admin notification settings"><header><div><h2>Notifications</h2><p>Manage phone alerts for your rental team.</p></div><OwnerNotificationBell token={token}/></header>
    {!data?<p role="status">Loading notification settings…</p>:<>
      <div className={styles.status}><span className={data.configured?styles.on:styles.off}>{data.configured?"Push service configured":"Push service not configured"}</span><p>Alerts are sent for requests to speak with the team and replies in team-handled conversations. Turning off phone alerts keeps the attention list in Messages available.</p></div>
      <div className={styles.guide}><h3>Set up this phone</h3><p>Open the admin page on your phone and enable Phone alerts. On iPhone or iPad, first use Share → Add to Home Screen, open the new icon and enable alerts there. Browser permission is required.</p></div>
      <h3>Team devices</h3><p className={styles.note}>Settings apply separately to each device. {data.moreDevices?"Showing the 50 newest devices.":""}</p>
      {!data.devices.length?<p>No team devices are registered yet.</p>:<div className={styles.devices}>{data.devices.map(device=><form key={device.deviceId} onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void run(device.deviceId,()=>save({token,deviceId:device.deviceId,label:String(form.get("label")),humanRequests:form.has("humanRequests"),renterMessages:form.has("renterMessages")}));}}>
        <div className={styles.deviceHeading}><label>Device name<input name="label" required maxLength={80} defaultValue={device.label} key={device.label}/></label><span className={device.enabled?styles.on:styles.off}>{device.enabled?"Enabled":"Off"}</span></div>
        <label className={styles.toggle}><input name="humanRequests" type="checkbox" defaultChecked={device.humanRequests} key={`human-${device.humanRequests}`}/>Requests to speak with the team</label>
        <label className={styles.toggle}><input name="renterMessages" type="checkbox" defaultChecked={device.renterMessages} key={`message-${device.renterMessages}`}/>Replies in team-handled conversations</label>
        <small>Registered {new Date(device.createdAt).toLocaleDateString("en-GB")}</small>
        {device.lastError&&<p className={styles.error}>{device.lastError}</p>}
        <div className={styles.actions}><button type="submit" disabled={!!busy}>{busy===device.deviceId?"Saving…":"Save preferences"}</button>{device.enabled&&<button type="button" disabled={!!busy} onClick={()=>void run(device.deviceId,()=>disable({token,deviceId:device.deviceId}))}>Disable device</button>}</div>
      </form>)}</div>}
      <h3>Recent delivery attempts</h3><p className={styles.note}>The 30 newest delivery records. “Sent” means the push service accepted the alert; it does not confirm that a person saw it.</p>
      {!data.deliveries.length?<p>No delivery attempts yet.</p>:<div className={styles.deliveries}>{data.deliveries.map(d=><article key={d._id}><div><strong>{d.title}</strong><span>{d.deviceLabel} · {d.attempts} attempt{d.attempts===1?"":"s"}</span>{d.lastError&&<p className={styles.error}>{d.lastError}</p>}</div><div className={styles.deliveryState}><span>{d.status.replaceAll("_"," ")}</span><small>{new Date(d.updatedAt).toLocaleString("en-GB")}</small>{d.canRetry&&<button type="button" disabled={!!busy} onClick={()=>void run(d._id,()=>retry({token,deliveryId:d._id}))}>{busy===d._id?"Retrying…":"Retry delivery"}</button>}</div></article>)}</div>}
    </>}{error&&<p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
