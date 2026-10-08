"use client";
import {useEffect,useRef,useState} from "react";
import {useMutation,useQuery} from "convex/react";
import {api} from "@cvx/_generated/api";

export function OwnerNotificationBell({token}:{token:string}) {
  const [deviceId,setDeviceId]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[supported,setSupported]=useState(false),[ready,setReady]=useState(false),[connected,setConnected]=useState(false);
  const registration=useRef<ServiceWorkerRegistration|null>(null),subscription=useRef<PushSubscription|null>(null),epoch=useRef(0);
  const device=useQuery(api.adminNotifications.device,deviceId?{token,deviceId}:"skip");
  const subscribe=useMutation(api.adminNotifications.subscribe),disable=useMutation(api.adminNotifications.disable);
  useEffect(()=>{try{let id=localStorage.getItem("dbc_owner_push_device");if(!id){id=crypto.randomUUID();localStorage.setItem("dbc_owner_push_device",id);}setDeviceId(id);}catch{setError("Allow website storage to save this phone's settings.");}const apple=/iPad|iPhone|iPod/.test(navigator.userAgent)||navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1;const standalone=matchMedia("(display-mode: standalone)").matches||!!(navigator as Navigator&{standalone?:boolean}).standalone;setSupported(isSecureContext&&"serviceWorker"in navigator&&"PushManager"in window&&"Notification"in window&&(!apple||standalone));},[]);
  useEffect(()=>{
    const generation=++epoch.current;setBusy(false);setReady(false);setConnected(false);registration.current=null;subscription.current=null;
    if(!supported||!device?.configured||!device.publicKey)return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    void(async()=>{try{
      const reg=await navigator.serviceWorker.register("/admin-notifications-sw.js",{scope:"/admin",updateViaCache:"none"});
      await new Promise<void>((resolve,reject)=>{const worker=reg.installing??reg.waiting??reg.active;if(!worker)return reject(Error("Notification worker unavailable."));if(worker.state==="activated")return resolve();timer=setTimeout(()=>reject(Error("Notifications took too long to initialise. Reload to try again.")),15000);worker.addEventListener("statechange",()=>{if(worker.state==="activated"){clearTimeout(timer);resolve();}});});
      let existing=await reg.pushManager.getSubscription();const key=Uint8Array.from(atob(device.publicKey!.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
      if(existing?.options.applicationServerKey&&Array.from(new Uint8Array(existing.options.applicationServerKey)).join()!==Array.from(key).join()){await existing.unsubscribe();existing=null;}
      if(epoch.current!==generation)return;registration.current=reg;subscription.current=existing;setConnected(!!existing&&Notification.permission==="granted");setReady(true);
    }catch(e){if(epoch.current===generation)setError(e instanceof Error?e.message:"Notifications could not initialise.");}})();
    return()=>{++epoch.current;clearTimeout(timer);};
  },[token,supported,device?.configured,device?.publicKey,device?.enabled]);
  const active=!!device?.enabled&&connected;
  async function toggle(){if(!deviceId||busy)return;const generation=epoch.current;setBusy(true);setError(null);let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      if(active){await disable({token,deviceId});if(epoch.current!==generation)return;await subscription.current?.unsubscribe();subscription.current=null;setConnected(false);return;}
      if(!supported)throw Error("On iPhone, add the admin page to your Home Screen, open it there, then enable Phone alerts.");
      if(!device?.configured||!device.publicKey)throw Error("Phone notifications are not configured yet.");
      if(!registration.current||!ready)throw Error("Notifications are still initialising. Try again in a moment.");
      if(Notification.permission==="denied")throw Error("Allow notifications in your browser or phone settings, then reopen this page.");
      const key=Uint8Array.from(atob(device.publicKey.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
      // Starts in the customer's tap; the scoped worker was activated beforehand.
      const current=subscription.current??await Promise.race([registration.current.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("Your push service did not respond. Try again.")),20000);})]);
      if(epoch.current!==generation)return;subscription.current=current;setConnected(true);const data=current.toJSON();if(!data.endpoint||!data.keys?.p256dh||!data.keys.auth)throw Error("Browser returned an incomplete subscription.");
      await subscribe({token,deviceId,endpoint:data.endpoint,p256dh:data.keys.p256dh,auth:data.keys.auth});
    }catch(e){if(epoch.current===generation)setError(e instanceof Error?e.message:"Phone alerts could not be changed.");}finally{clearTimeout(timer);if(epoch.current===generation)setBusy(false);}
  }
  return <div className="relative"><button type="button" onClick={()=>void toggle()} disabled={busy||!device||supported&&!!device?.configured&&!ready} aria-label={active?"Disable phone alerts":"Enable phone alerts"} aria-pressed={active} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${active?"border-amber-300/30 bg-amber-300/10 text-amber-200":"border-white/10 text-white/50"}`}>
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill={active?"currentColor":"none"} stroke="currentColor" strokeWidth="1.5"><path d="M18 8a6 6 0 00-12 0v5l-2 3v1h16v-1l-2-3V8ZM9 20h6"/></svg>{busy?"Updating…":active?"Phone alerts on":device?.enabled?"Reconnect alerts":"Phone alerts"}</button>{(error||device?.lastError)&&<p role="alert" className="mt-2 max-w-xs text-xs text-amber-200">{error??device?.lastError}</p>}</div>;
}
