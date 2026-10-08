"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import styles from "./RenterNotificationBell.module.css";
type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
export function RenterNotificationBell({token}:{token:string}) {
  const [open,setOpen]=useState(false),[deviceId,setDeviceId]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [supported,setSupported]=useState(false),[ios,setIos]=useState(false),[installed,setInstalled]=useState(false),[install,setInstall]=useState<InstallEvent|null>(null);
  const [connected,setConnected]=useState(false);
  const [ready,setReady]=useState(false),[permission,setPermission]=useState<NotificationPermission>("default");
  const registration=useRef<ServiceWorkerRegistration|null>(null),browserSubscription=useRef<PushSubscription|null>(null),epoch=useRef(0);
  const state=useQuery(api.renterNotifications.device,deviceId?{token,deviceId}:"skip");
  const subscribe=useMutation(api.renterNotifications.subscribe),disable=useMutation(api.renterNotifications.disable),preferences=useMutation(api.renterNotifications.preferences);
  useEffect(()=>{
    try {let id=localStorage.getItem("dbc_renter_push_device");if(!id){id=crypto.randomUUID();localStorage.setItem("dbc_renter_push_device",id);}setDeviceId(id);}catch{setError("Allow website storage to save this device's notification settings.");}
    const apple=/iPad|iPhone|iPod/.test(navigator.userAgent)||navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1;
    setIos(apple);setInstalled(matchMedia("(display-mode: standalone)").matches||!!(navigator as Navigator&{standalone?:boolean}).standalone);
    setSupported(isSecureContext&&"serviceWorker"in navigator&&"PushManager"in window&&"Notification"in window);
    if("Notification"in window)setPermission(Notification.permission);
    const prompt=(event:Event)=>{event.preventDefault();setInstall(event as InstallEvent);};const done=()=>{setInstalled(true);setInstall(null);};
    window.addEventListener("beforeinstallprompt",prompt);window.addEventListener("appinstalled",done);
    return()=>{window.removeEventListener("beforeinstallprompt",prompt);window.removeEventListener("appinstalled",done);};
  },[]);
  useEffect(()=>{
    const generation=++epoch.current;setReady(false);setConnected(false);setBusy(false);registration.current=null;browserSubscription.current=null;
    if(!supported||!state?.configured||!state.publicKey||ios&&!installed)return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    void(async()=>{try {
      const reg=await navigator.serviceWorker.register("/renter-notifications-sw.js",{scope:"/account",updateViaCache:"none"});
      await new Promise<void>((resolve,reject)=>{const worker=reg.installing??reg.waiting??reg.active;if(!worker)return reject(Error("Notification worker unavailable."));if(worker.state==="activated")return resolve();timer=setTimeout(()=>reject(Error("Notifications took too long to initialise. Reload to try again.")),15000);worker.addEventListener("statechange",()=>{if(worker.state==="activated"){clearTimeout(timer);resolve();}});});
      let existing=await reg.pushManager.getSubscription();const key=Uint8Array.from(atob(state.publicKey!.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
      if(existing?.options.applicationServerKey&&Array.from(new Uint8Array(existing.options.applicationServerKey)).join()!==Array.from(key).join()){await existing.unsubscribe();existing=null;}
      if(epoch.current!==generation)return;registration.current=reg;browserSubscription.current=existing;setConnected(!!existing&&Notification.permission==="granted");setPermission(Notification.permission);setReady(true);
    }catch(e){if(epoch.current===generation)setError(e instanceof Error?e.message:"Notifications could not initialise.");}})();
    return()=>{++epoch.current;clearTimeout(timer);};
  },[token,supported,ios,installed,state?.configured,state?.publicKey]);
  useEffect(()=>{if(!open)return;const close=(e:KeyboardEvent)=>{if(e.key==="Escape")setOpen(false);};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);},[open]);
  async function enable() {
    if(busy||!deviceId||!state?.publicKey||!registration.current)return;
    const generation=epoch.current;setBusy(true);setError(null);
    try {
      if(Notification.permission==="denied")throw Error("Notifications are blocked. Allow them in your browser or phone notification settings, then reopen this page.");
      // Worker and key are prepared beforehand; subscribe starts directly from this tap.
      const key=Uint8Array.from(atob(state.publicKey.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
      const subscription=browserSubscription.current??await registration.current.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      if(epoch.current!==generation)return;
      setPermission(Notification.permission);setConnected(true);browserSubscription.current=subscription;const json=subscription.toJSON();
      if(!json.endpoint||!json.keys?.p256dh||!json.keys.auth)throw Error("The browser returned an incomplete subscription.");
      await subscribe({token,deviceId,endpoint:json.endpoint,p256dh:json.keys.p256dh,auth:json.keys.auth});
    }catch(e){if(epoch.current===generation){setPermission(Notification.permission);setError(e instanceof Error?e.message:"Notifications could not be enabled.");}}
    finally{if(epoch.current===generation)setBusy(false);}
  }
  async function stop(){if(!deviceId||busy)return;const generation=epoch.current;setBusy(true);setError(null);try{await disable({token,deviceId});if(epoch.current!==generation)return;await browserSubscription.current?.unsubscribe();browserSubscription.current=null;setConnected(false);}catch(e){if(epoch.current===generation)setError(e instanceof Error?e.message:"Notifications could not be disabled.");}finally{if(epoch.current===generation)setBusy(false);}}
  async function change(kind:"messagesEnabled"|"bookingEnabled",value:boolean){if(!deviceId||!state)return;const generation=epoch.current;setBusy(true);setError(null);try{await preferences({token,deviceId,messagesEnabled:state.messagesEnabled,bookingEnabled:state.bookingEnabled,[kind]:value});}catch(e){if(epoch.current===generation)setError(e instanceof Error?e.message:"Preferences could not be saved.");}finally{if(epoch.current===generation)setBusy(false);}}
  const active=!!state?.enabled&&connected&&permission==="granted";
  return <div className={styles.root}>
    <button type="button" onClick={()=>setOpen(!open)} aria-expanded={open} aria-controls="renter-notification-settings" aria-label={active?"Manage enabled rental notifications":"Rental notifications"} className={styles.bell}><svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 8a6 6 0 00-12 0v5l-2 3v1h16v-1l-2-3V8ZM9 20h6"/></svg><span>{active?"Alerts on":"Notifications"}</span></button>
    {open&&<section id="renter-notification-settings" className={styles.panel} aria-label="Rental notification settings"><header><h2>Stay in touch with your rental</h2><button type="button" onClick={()=>setOpen(false)} aria-label="Close notification settings">×</button></header>
      <p>Receive booking updates and messages from the rental team on this device. For phone alerts, open your account on your phone.</p>
      {!installed&&<div className={styles.install}><h3>Add DB Cinema to your Home Screen</h3><p>{ios?"On iPhone or iPad, open the browser's Share menu, choose Add to Home Screen, then open DB Cinema from its new icon and enable notifications here.":"Use your browser's Install app or Add to Home Screen option, then open DB Cinema from the new icon."}</p>{install&&<button type="button" onClick={async()=>{try{await install.prompt();await install.userChoice;setInstall(null);}catch{setError("The installation prompt could not open. Use your browser’s Add to Home Screen menu instead.");}}}>Add to Home Screen</button>}</div>}
      {!supported&&!(ios&&!installed)&&<p>Push notifications are unavailable in this browser. Try a supported phone browser or keep using your rental chat here.</p>}
      {!state?.configured&&<p>Device notifications are not configured yet. Your booking conversations remain available in Messages.</p>}
      {active?<><label><input type="checkbox" checked={state.messagesEnabled} disabled={busy} onChange={e=>void change("messagesEnabled",e.target.checked)}/>Messages from the rental team</label><label><input type="checkbox" checked={state.bookingEnabled} disabled={busy} onChange={e=>void change("bookingEnabled",e.target.checked)}/>Booking and required-action updates</label><button type="button" disabled={busy} onClick={()=>void stop()}>Turn off on this device</button></>:<button type="button" disabled={busy||!ready||ios&&!installed} onClick={()=>void enable()}>{busy?"Enabling…":state?.enabled?"Reconnect notifications":"Enable notifications"}</button>}
      {(error||state?.lastError||permission==="denied")&&<p role="alert">{error??(permission==="denied"?"Notifications are blocked in your browser settings. Allow them there, then reopen your account.":state?.lastError)}</p>}
      <small>Private messages and documents are only shown after signing in. Signing out stops future alerts for this session.</small>
    </section>}
  </div>;
}
