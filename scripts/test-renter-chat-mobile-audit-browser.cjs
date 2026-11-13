const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");
const postcss = require("postcss");
const source = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", source.slice(0, source.indexOf("const { ConvexHttpClient }")) + ";return connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const camera = "https://pub-761e4d18b3b84542809dddc11936a8df.r2.dev/listings/1011153/0.jpg";
const lens = "https://hygglo.imgix.net/fat-llama/products/gmaster-lens-sony-2470mm-f28-21919134.jpeg?cs=strip&fm=pjpg&q=70";
const entry = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {RenterChat} from './src/components/RenterChat';
const root=createRoot(document.getElementById('root'));
root.render(<div className="renter-page"><div id="renter-chat" className="tab-in mt-6"><RenterChat focusBookingId="general"/></div></div>);`;

(async () => {
  const root = path.resolve(__dirname, "..");
  const globalCss = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const aliases = new Set([
    "./account/AccountProvider", "next/image", "./RentalAdditionApproval", "./RentalPricePanel", "./SavedCardCharges", "./ChatIdentity", "./RentalCreditOffer", "@/components/account/BookingReview", "./RentalVerificationSummary", "./RentalDeliveryQuoteApproval", "./AttachmentAdminControls", "./RentalSwapApproval", "./RentalRequestHistory", "./HumanHandoffOffer", "./GafferExtensionOfferCard", "convex/react", "@cvx/_generated/api",
  ]);
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" },
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_CONVEX_URL": '"https://fixture.invalid"', "process.env.NEXT_PUBLIC_CONVEX_SITE_URL": '"."', "process.env": "{}" },
    plugins: [{ name: "synthetic-renter-chat", setup(build) {
      build.onResolve({ filter: /.*/ }, args => aliases.has(args.path) ? { path: args.path, namespace: "renter-fixture" } : null);
      build.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: require.resolve(args.path, { paths: [root] }) }));
      build.onLoad({ filter: /.*/, namespace: "renter-fixture" }, args => {
        if (args.path === "./account/AccountProvider") return { loader: "js", contents: `export const useAccount=()=>({token:'synthetic-renter'});` };
        if (args.path === "next/image") return { loader: "jsx", contents: `export default function Image({src,alt,className,...props}){return <img src={src} alt={alt||''} className={className} {...props}/>} ` };
        if (args.path === "./ChatIdentity") return { loader: "jsx", contents: `import React from'react';export function GafferIcon({className}){return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5 12h14M12 5v14M7 7l10 10M17 7 7 17"/></svg>}export function ChatAvatar({sender,name,photo}){return <span data-testid="chat-avatar" role="img" aria-label={name||sender} style={{display:'grid',placeItems:'center',width:38,height:38,borderRadius:'50%',flex:'0 0 38px',background:'#252b29',color:'#d9bd9d',overflow:'hidden'}}>{photo?<img src={photo} alt=""/>:sender==='bot'?<GafferIcon className="h-6 w-6"/>:(name||'R').slice(0,1)}</span>}` };
        if (args.path === "convex/react") return { loader: "js", contents: `export const useQuery=(ref,args)=>args==='skip'?undefined:window.__query(String(ref),args);export const usePaginatedQuery=(ref,args)=>window.__pages(String(ref),args);export const useMutation=ref=>async args=>{window.__mutations.push({ref:String(ref),args});return {ok:true}};export const useAction=ref=>async args=>{window.__actions.push({ref:String(ref),args});return true};` };
        if (args.path === "@cvx/_generated/api") return { loader: "js", contents: `const path=(a)=>new Proxy({}, {get:(_,b)=>a+'.'+String(b)});export const api=new Proxy({}, {get:(_,a)=>path(String(a))});` };
        const exports = args.path === "./RentalExtensionPanel" ? "RentalExtensionPanel" : args.path === "./RentalCreditOffer" ? "RentalCreditOffer" : args.path === "./GafferExtensionOfferCard" ? "GafferExtensionOfferCard" : args.path === "./HumanHandoffOffer" ? "HumanHandoffOffer" : args.path === "./RentalVerificationSummary" ? "RentalVerificationSummary" : args.path === "./RentalDeliveryQuoteApproval" ? "RentalDeliveryQuoteApproval" : args.path === "./RentalAdditionApproval" ? "RentalAdditionApproval" : args.path === "./RentalPricePanel" ? "RentalPricePanel" : args.path === "./SavedCardCharges" ? "SavedCardCharges" : args.path === "./RentalRequestHistory" ? "RentalRequestHistory" : args.path === "./RentalSwapApproval" ? "RentalSwapApproval" : args.path === "./AttachmentAdminControls" ? "AttachmentAdminControls" : args.path === "@/components/account/BookingReview" ? "BookingReview" : "";
        if (exports) return { loader: "jsx", contents: `export function ${exports}(){return null}` };
        return { loader: "js", contents: "export {};" };
      });
    }}],
  });
  const css = `${globalCss.css}\n${bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? ""}`;
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js"))?.text;
  assert(script, "Renter chat fixture bundle contains JavaScript");
  const server = http.createServer((request, response) => {
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css); }
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(script); }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>
      html,body,#root{width:100%;height:100%;margin:0;background:#101111;color:#f2ede4;font-family:Arial,sans-serif}*{box-sizing:border-box}.shell{height:100dvh;display:flex;flex-direction:column;overflow:hidden}.site-head{height:60px;flex:0 0 60px;display:flex;align-items:center;gap:12px;padding:0 18px;background:#070808;border-bottom:1px solid #292a29;color:#f1e6d7;font-size:13px}.site-head small{color:#a49f97}.renter-page{height:100%;min-height:0;overflow:hidden;padding:0 8px}.renter-page #renter-chat{height:100%;min-height:0;margin:0!important}.renter-page .renterInbox{height:100%;min-height:0}.renter-page .renterInbox .main{min-height:0}
      </style></head><body><div class="shell"><header class="site-head"><strong>DB CINEMA</strong><small>/ My account / Messages</small></header><main style="flex:1;min-height:0;overflow:hidden"><div id="root"></div></main></div><script>
      window.__mutations=[];window.__actions=[];window.__gafferOpen=null;window.addEventListener('dbc:open-gaffer-chat',event=>window.__gafferOpen=event.detail);window.addEventListener('dbc:request-renter-notification-status',()=>window.dispatchEvent(new CustomEvent('dbc:renter-notification-status',{detail:'inactive'})));
      const camera=${JSON.stringify(camera)},lens=${JSON.stringify(lens)},day=86400000,start=Date.UTC(2030,0,2),end=Date.UTC(2030,0,4);
      const items=[{index:0,listingId:'listing-camera',slug:'sony-fx3',title:'Sony FX3 camera',qty:1,start,end,returnTime:'17:00',heroImage:camera,imageSources:[camera]},{index:1,listingId:'listing-lens',slug:'sony-24-70',title:'Sony 24–70mm lens',qty:1,start,end,returnTime:'17:00',heroImage:lens,imageSources:[lens]}];
      const row={_id:'booking-camera',status:'confirmed',idVerifyStatus:'verified',idVerificationSource:'didit',idVerifiedAt:Date.now()-86400000,verificationArchiveReady:true,verificationChecks:{identity:'approved',selfie:'approved',address:'approved'},start,end,items,unreadRenter:2,escalated:false,handoverDetails:{phone:'+44 7933 019849',pickupAddress:'The Grand Building, Trafalgar Square, London WC2N 5EJ',returnAddress:'The Grand Building, Trafalgar Square, London WC2N 5EJ',pickupInstructions:'Please meet outside Waterstones at Trafalgar Square.',fulfilment:'pickup'}};
      const conversation={notificationScope:'synthetic-renter',page:[{_id:'renter-message',sender:'renter',text:'Could I extend the camera and move the return to Friday?',at:Date.UTC(2029,11,28)},{_id:'gaffer-reply',sender:'bot',text:'Yes. I can check stock and calculate the extension.',at:Date.UTC(2029,11,28)+60000}],isDone:false,continueCursor:'older-page',escalated:false,replyState:{awaitingTeam:false,awaitingReply:false,renterAt:Date.UTC(2029,11,28)},quickReplies:[],renter:{name:'Jordan Blake',phone:'+44 7700 900123',photo:null}};
      window.__query=(ref,args)=>{if(ref==='rentalChat.getConversation')return row;if(ref==='rentalChat.unreadBreakdown')return{general:1,rentals:2};if(ref==='rentalChat.messages')return conversation;if(ref==='rentalRequests.context')return{status:'confirmed',actionReady:true,start,end,items,cancellationKind:'full_refund',cancellationFullRefundDays:7,cancellationTermsVersion:'2026-11-v21',direct:true,selfService:true,locked:false};if(ref==='cancellationRecovery.renterStatus')return null;if(ref==='rentalOperations.renterReschedulePreview')return{ok:true,start:args.start,end:args.start+2*day,controlsSnapshot:'synthetic'};if(ref==='rentalExtensions.state')return{status:'confirmed',actionReady:true,locked:false,pickupTime:'09:00',returnTime:'17:00',items,requests:[],paymentsEnabled:true};if(ref==='rentalExtensions.quote'){const conflict=!args.lineItemIndexes||args.lineItemIndexes.length>1;const index=conflict?0:args.lineItemIndexes[0];return{available:true,partialAvailability:conflict,availableIndexes:conflict?[0]:args.lineItemIndexes,individuallyAvailableIndexes:[0,1],selectionConflictItems:conflict?[{lineIndex:1,title:'Sony 24–70mm lens',qty:1,reason:'Available alone'}]:[],unavailableItems:[],items:[{lineIndex:index,listingId:items[index].listingId,title:items[index].title,qty:1,start:end,end:end+day,lineTotal:24.68}],priceDelta:conflict?24.68:24.68,baseLines:'synthetic-base',benefitSaving:0};}if(ref==='cartReplacements.forCart')return{'1':[{slug:'sony-fx6',title:'Sony FX6 camera',heroImage:camera,imageSources:[camera],total:68}]};return null};
      window.__pages=(ref,args)=>ref==='rentalChat.minePage'?{results:[row],status:'Exhausted',loadMore:()=>{}}:ref==='rentalRequests.list'?{results:[],status:'Exhausted',loadMore:()=>{}}:{results:[],status:'Exhausted',loadMore:()=>{}};
      </script><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-renter-chat-audit-"));
  const attached = !!process.env.DBC_CDP_URL;
  const chrome = attached ? null : spawn(process.env.CHROME_BIN || "/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${process.env.CHROME_DEBUG_PORT || "0"}`, `--user-data-dir=${profile}`], { stdio: "ignore" });
  let client;
  try {
    let port = process.env.CHROME_DEBUG_PORT || (attached ? new URL(process.env.DBC_CDP_URL).port : undefined);
    for (let i=0; !port && i<100; i++) { try { port=fs.readFileSync(`${profile}/DevToolsActivePort`,"utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port, "Headless Chrome starts for the isolated renter fixture");
    if (!attached) process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;
    client=await connect(); await client.cmd("Page.enable");
    for (const [width,height] of [[320,640],[320,667],[390,844],[430,932],[768,900]]) {
      await client.cmd("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:width<768});
      await client.evaluate(`try{localStorage.clear()}catch{}`);
      await client.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/`});
      for(let i=0;i<100&&!await client.evaluate(`!!document.querySelector('[data-conversation-scope]')`);i++)await wait(50);
      await wait(250);
      const general=await client.evaluate(`(()=>{const pane=document.querySelector('[data-conversation-scope]'),composer=pane?.querySelector('footer'),messages=pane?.querySelector('[aria-label="Rental conversation"]'),inbox=document.querySelector('[data-renter-support]'),c=composer?.getBoundingClientRect(),m=messages?.getBoundingClientRect(),first=messages?.querySelector('[data-message-id]'),f=first?.getBoundingClientRect(),header=pane?.querySelector('header')?.getBoundingClientRect(),ask=pane?.querySelector('[data-testid="rental-gaffer-gear-help"]'),a=ask?.getBoundingClientRect();return{width:innerWidth,viewport:innerHeight,documentWidth:document.documentElement.scrollWidth,conversationWidth:pane?.getBoundingClientRect().width,composerBottom:c?.bottom,messagesHeight:m?.height,messagesTop:m?.top,messageScrollTop:messages?.scrollTop,firstMessageTop:f?.top,firstMessageBottom:f?.bottom,firstMessageVisible:!!m&&!!f&&f.top>=m.top-1,askGafferInHeader:!!a&&!!header&&a.top>=header.top&&a.bottom<=header.bottom,hasNotification:!!pane?.querySelector('[aria-label="Chat notifications"]'),inboxClass:inbox?.className,inboxData:inbox?.getAttribute('data-renter-support'),inboxDisplay:inbox?getComputedStyle(inbox).display:null,inboxHeight:inbox?.getBoundingClientRect().height,rootHeight:document.querySelector('.renter-page')?.getBoundingClientRect().height,mainHeight:document.querySelector('main')?.getBoundingClientRect().height}})()`);
      assert(general&&general.documentWidth<=width,`Pass 1 general chat fits at ${width}px: ${JSON.stringify(general)}`);
      assert(general.composerBottom<=height&&general.messagesHeight>80,`Pass 1 general chat keeps a usable message area and docked composer at ${width}px: ${JSON.stringify(general)}`);
      assert(general.hasNotification,`Pass 1 first Gaffer answer gets an immediate chat-alert prompt even when history has older pages at ${width}px`);
      assert(general.firstMessageVisible,`Pass 1 keeps the opening renter message entirely below the header at ${width}x${height}: ${JSON.stringify(general)}`);
      assert(general.askGafferInHeader,`Pass 1 places the Gaffer shortcut in the chat header, clear of the message thread at ${width}x${height}: ${JSON.stringify(general)}`);
      await client.evaluate(`document.querySelector('[data-testid="rental-gaffer-gear-help"]').click()`);
      const gafferHandoff=await client.evaluate(`window.__gafferOpen`);
      assert(gafferHandoff?.prompt?.includes('account support chat'),`Pass 1 Gaffer header shortcut opens the account-aware prompt at ${width}x${height}: ${JSON.stringify(gafferHandoff)}`);
      assert.equal(await client.evaluate(`document.querySelector('[aria-label="Chat notifications"]').previousElementSibling?.getAttribute('data-message-id')`),"gaffer-reply",`Pass 1 notification prompt follows Gaffer's answer at ${width}px`);
      const alertButtons=await client.evaluate(`(()=>[...document.querySelectorAll('[aria-label="Chat notifications"] button')].map(button=>({text:button.textContent.trim(),width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height,minHeight:getComputedStyle(button).minHeight})))()`);
      if(width===320&&height===640)console.log(`Pass 1 alert target measurements: ${JSON.stringify(alertButtons)}`);
      assert(alertButtons.length===2&&alertButtons.every(button=>button.height>=44),`Pass 1 alert controls meet the 44px touch size at ${width}px: ${JSON.stringify(alertButtons)}`);
      fs.writeFileSync(`/tmp/dbc-renter-audit-${width}x${height}-pass1-general.png`,Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));

      await client.evaluate(`document.querySelector('[aria-label="Your conversations"] button:not([aria-current="true"])').click()`); await wait(420);
      const hasActionDisclosure=await client.evaluate(`(()=>{const button=document.querySelector('[data-testid="renter-actions-toggle"]');return !!button&&button.getBoundingClientRect().height>0})()`);
      if(hasActionDisclosure){
        await client.evaluate(`document.querySelector('[data-testid="renter-actions-toggle"]').focus()`);
        await client.cmd("Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",code:"Enter",text:"\r",unmodifiedText:"\r",windowsVirtualKeyCode:13});
        await client.cmd("Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13}); await wait(100);
        assert.equal(await client.evaluate(`document.querySelector('[data-testid="renter-actions-toggle"]')?.getAttribute('aria-expanded')`),"true",`Pass 2 action disclosure opens by keyboard at ${width}x${height}`);
        await client.evaluate(`document.querySelector('[data-testid="renter-actions-toggle"]').click()`); await wait(60);
        assert.equal(await client.evaluate(`document.querySelector('[data-testid="renter-actions-toggle"]')?.getAttribute('aria-expanded')`),"false",`Pass 2 action disclosure closes by touch at ${width}x${height}`);
        await client.evaluate(`document.querySelector('[data-testid="renter-actions-toggle"]').click()`); await wait(150);
      }
      const booking=await client.evaluate(`(()=>{const pane=document.querySelector('[data-conversation-scope]'),composer=pane?.querySelector('footer'),scroller=pane?.querySelector('[aria-label="Rental conversation"]'),card=pane?.querySelector('[data-testid="rental-items-in-chat"]'),c=composer?.getBoundingClientRect(),s=scroller?.getBoundingClientRect(),cardBox=card?.getBoundingClientRect(),images=[...pane.querySelectorAll('[data-testid="rental-items-in-chat"] img')];return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,composerBottom:c?.bottom,itemsVisible:!!card&&cardBox.top>=s.top-1&&cardBox.bottom<=s.bottom+1,scrollerBounds:s&&{top:s.top,bottom:s.bottom,height:s.height},itemBounds:cardBox&&{top:cardBox.top,bottom:cardBox.bottom,height:cardBox.height},images:images.map(image=>({alt:image.alt,src:image.getAttribute('src'),width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height,naturalWidth:image.naturalWidth})),controls:[...pane.querySelectorAll('[data-testid^="renter-request-"]')].map(b=>{const r=b.getBoundingClientRect();return{name:b.getAttribute('aria-label'),width:r.width,height:r.height,top:r.top,left:r.left}})}})()`);
      assert(booking&&booking.documentWidth<=width,`Pass 2 rental conversation fits at ${width}px: ${JSON.stringify(booking)}`);
      const notification=await client.evaluate(`(()=>{const p=document.querySelector('[data-conversation-scope]'),c=p?.querySelector('[aria-label="Chat notifications"]'),s=p?.querySelector('[aria-label="Rental conversation"]'),f=p?.querySelector('footer'),r=c?.getBoundingClientRect(),v=s?.getBoundingClientRect(),q=f?.getBoundingClientRect();return{visible:!!c&&r.top>=v.top&&r.bottom<=v.bottom,clearOfComposer:!!v&&v.bottom<=q.top,card:{top:r?.top,bottom:r?.bottom},messages:{top:v?.top,bottom:v?.bottom},composer:{top:q?.top,bottom:q?.bottom}}})()`);
      if(hasActionDisclosure) {
        assert(notification.visible&&notification.clearOfComposer,`Pass 2 expanded actions keep the compact alert prompt fully visible above the composer at ${width}x${height}: ${JSON.stringify(notification)}`);
        fs.writeFileSync(`/tmp/dbc-renter-audit-${width}x${height}-notification.png`,Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
      }
      await client.evaluate(`document.querySelector('[aria-label="Chat notifications"] button:last-child')?.click()`); await wait(180);
      assert(await client.evaluate(`!!document.querySelector('[data-testid="renter-notification-settings"]')`),`Pass 2 keeps notification settings reachable in the chat header after dismissal at ${width}x${height}`);
      const itemsVisible=await client.evaluate(`(()=>{const p=document.querySelector('[data-conversation-scope]'),c=p?.querySelector('[data-testid="rental-items-in-chat"]'),s=p?.querySelector('[aria-label="Rental conversation"]'),f=p?.querySelector('footer');if(!c||!s||!f)return false;const r=c.getBoundingClientRect(),v=s.getBoundingClientRect(),q=f.getBoundingClientRect();return r.top>=v.top-1&&r.bottom<=v.bottom+1&&v.bottom<=q.top+1})()`);
      assert(itemsVisible,`Pass 2 selected rental card can be reached above the composer at ${width}x${height}`);
      assert(booking.images.length===2&&booking.images.every(image=>/^https:\/\//.test(image.src)&&image.width>=48&&image.height>=48),`Pass 2 uses readable real listing photos in 48px tiles at ${width}px: ${JSON.stringify(booking.images)}`);
      const visibleActions=booking.controls.filter(button=>button.height>0);
      assert(visibleActions.length===(width<768?5:4)&&visibleActions.every(button=>button.height>=42),`Pass 2 renter action touch targets remain >=42px at ${width}x${height}: ${JSON.stringify(visibleActions)}`);
      if(width>=361&&width<=430){const rows=new Set(visibleActions.map(button=>Math.round(button.top))).size;assert.equal(rows,2,`Pass 2 compact action grid keeps the visible message area taller with two rows at ${width}px: ${JSON.stringify(visibleActions)}`);}
      fs.writeFileSync(`/tmp/dbc-renter-audit-${width}x${height}-pass2-rental.png`,Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));

      if(width<1024){
        await client.evaluate(`document.querySelector('[data-testid="request-extension-open"]').click()`);
        await client.evaluate(`(()=>{const select=document.querySelector('[data-testid="extension-return-time"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'16:00');select.dispatchEvent(new Event('change',{bubbles:true}));})()`); await wait(120);
        const extension=await client.evaluate(`(()=>{const main=document.querySelector('[data-conversation-scope] [class*="RentalConversation_main"]'),form=document.querySelector('[data-testid="extension-request-form"]'),button=document.querySelector('[data-testid="extension-send-request"]'),composer=document.querySelector('[data-conversation-scope] footer');return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,mainHeight:main?.clientHeight,mainScrollHeight:main?.scrollHeight,mainOverflow:main?getComputedStyle(main).overflowY:null,formHeight:form?.getBoundingClientRect().height,sendPresent:!!button,composerBottom:composer?.getBoundingClientRect().bottom,realImages:[...form.querySelectorAll('img')].filter(image=>image.getAttribute('src')?.startsWith('https://')).length}})()`);
        assert(extension.documentWidth<=width&&extension.sendPresent&&extension.composerBottom<=height,`Pass 3 extension form remains operable with the composer visible at ${width}px: ${JSON.stringify(extension)}`);
        assert(extension.mainOverflow==='auto'||extension.mainScrollHeight<=extension.mainHeight,`Pass 3 expanded extension content has a usable scroll area at ${width}px: ${JSON.stringify(extension)}`);
        assert(extension.realImages>=2,`Pass 3 extension selection shows real listing photos at ${width}px`);
        fs.writeFileSync(`/tmp/dbc-renter-audit-${width}x${height}-pass3-extension-top.png`,Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
        await client.evaluate(`(()=>{const main=document.querySelector('[data-conversation-scope] [class*="RentalConversation_main"]'),button=document.querySelector('[data-testid="extension-send-request"]'),composer=document.querySelector('[data-conversation-scope] footer'),b=button?.getBoundingClientRect(),c=composer?.getBoundingClientRect();if(main&&b&&c){main.scrollTop+=Math.max(0,b.bottom-(c.top-8));}})()`); await wait(150);
        const extensionAction=await client.evaluate(`(()=>{const main=document.querySelector('[data-conversation-scope] [class*="RentalConversation_main"]'),button=document.querySelector('[data-testid="extension-send-request"]'),composer=document.querySelector('[data-conversation-scope] footer'),header=document.querySelector('[data-conversation-scope] header'),handover=document.querySelector('[data-testid="renter-handover-details"]'),m=main?.getBoundingClientRect(),b=button?.getBoundingClientRect(),c=composer?.getBoundingClientRect(),h=header?.getBoundingClientRect(),r=handover?.getBoundingClientRect();return{main:{top:m?.top,bottom:m?.bottom},handover:{top:r?.top,bottom:r?.bottom},button:{top:b?.top,bottom:b?.bottom},composer:{top:c?.top,bottom:c?.bottom},headerTop:h?.top,pageScrollY:window.scrollY,reachable:!!m&&!!b&&b.top>=m.top&&b.bottom<=Math.min(m.bottom,c.top)+1&&Math.abs(innerHeight-c.bottom)<=2&&window.scrollY===0,mainStartsAfterHandover:!r||m.top>=r.bottom-1}})()`);
        assert(extensionAction.reachable,`Pass 3 extension submit is reachable by scrolling only the chat pane while the composer stays at the viewport bottom at ${width}x${height}: ${JSON.stringify(extensionAction)}`);
        assert(extensionAction.mainStartsAfterHandover,`Pass 3 scrollable rental tools start below the fixed pickup details at ${width}x${height}: ${JSON.stringify(extensionAction)}`);
        fs.writeFileSync(`/tmp/dbc-renter-audit-${width}x${height}-pass3-extension-bottom.png`,Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
      }

      await client.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/`});
      for(let i=0;i<100&&!await client.evaluate(`!!document.querySelector('[data-conversation-scope]')`);i++)await wait(50);
      await wait(220);
      await client.evaluate(`document.querySelector('[aria-label="Your conversations"] button:not([aria-current="true"])').click()`); await wait(220);
      const cancel=await client.evaluate(`!!document.querySelector('[data-testid="renter-request-cancel"]')`);
      assert(cancel,`Pass 4 cancellation options are offered for confirmed booking at ${width}px`);
      await client.evaluate(`document.querySelector('[data-testid="renter-request-cancel"]').click()`); await wait(120);
      const cancellationStart=await client.evaluate(`(()=>{const main=document.querySelector('[data-conversation-scope] [class*="RentalConversation_main"]'),policy=document.querySelector('[data-testid="renter-cancellation-policy-line"]'),terms=[...document.querySelectorAll('[data-testid="renter-rental-tools"] form a')].find(a=>a.textContent.includes('Accepted terms')),m=main?.getBoundingClientRect(),p=policy?.getBoundingClientRect(),t=terms?.getBoundingClientRect();return{policy:policy?.innerText,policyVisible:!!m&&!!p&&p.top>=m.top&&p.bottom<=m.bottom,termsVisible:!!m&&!!t&&t.top>=m.top&&t.bottom<=m.bottom}})()`);
      assert(cancellationStart.policyVisible&&cancellationStart.termsVisible,`Pass 4 cancellation policy and accepted terms are visible on open at ${width}px: ${JSON.stringify(cancellationStart)}`);
      fs.writeFileSync(`/tmp/dbc-renter-audit-${width}x${height}-pass4-cancellation-start.png`,Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
      await client.evaluate(`(()=>{const main=document.querySelector('[data-conversation-scope] [class*="RentalConversation_main"]'),form=document.querySelector('[data-testid="renter-rental-tools"] form'),composer=document.querySelector('[data-conversation-scope] footer'),submit=[...form.querySelectorAll('button')].find(button=>/^(Request cancellation|Abandon checkout)$/.test(button.textContent.trim())),b=submit?.getBoundingClientRect(),c=composer?.getBoundingClientRect();if(main&&b&&c)main.scrollTop+=Math.max(0,b.bottom-(c.top-8));})()`); await wait(150);
      const cancellation=await client.evaluate(`(()=>{const main=document.querySelector('[data-conversation-scope] [class*="RentalConversation_main"]'),form=document.querySelector('[data-testid="renter-rental-tools"] form'),composer=document.querySelector('[data-conversation-scope] footer'),handover=document.querySelector('[data-testid="renter-handover-details"]'),submit=[...form.querySelectorAll('button')].find(button=>/^(Request cancellation|Abandon checkout)$/.test(button.textContent.trim())),m=main?.getBoundingClientRect(),b=submit?.getBoundingClientRect(),c=composer?.getBoundingClientRect(),r=handover?.getBoundingClientRect(),summary=form.querySelector('[data-testid="renter-cancellation-summary"]'),policy=form.querySelector('[data-testid="renter-cancellation-policy-line"]'),after=[...form.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent.includes('What happens next')),terms=[...form.querySelectorAll('a')].find(a=>a.textContent.includes('Accepted terms')),t=terms?.getBoundingClientRect();return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,formHeight:form?.getBoundingClientRect().height,summaryText:summary?.innerText,policyLength:policy?.innerText.length,formChildren:[...form.children].map(e=>({tag:e.tagName,height:e.getBoundingClientRect().height,text:e.innerText.slice(0,60)})),afterCollapsed:!!after&&!after.open,mainHeight:main?.clientHeight,mainScrollHeight:main?.scrollHeight,mainOverflow:main?getComputedStyle(main).overflowY:null,handover:{top:r?.top,bottom:r?.bottom},mainTop:m?.top,composerBottom:c?.bottom,submitHeight:b?.height,submitReachable:!!m&&!!b&&!!c&&b.top>=m.top&&b.bottom<=Math.min(m.bottom,c.top)+1,termsVisible:!!t&&!!m&&!!c&&t.top>=m.top&&t.bottom<=Math.min(m.bottom,c.top)+1,mainStartsAfterHandover:!r||m.top>=r.bottom-1,pageScrollY:window.scrollY}})()`);
      assert(cancellation.documentWidth<=width&&cancellation.formHeight>0&&cancellation.composerBottom<=height,`Pass 4 cancellation form fits without covering the composer at ${width}px: ${JSON.stringify(cancellation)}`);
      assert(cancellation.mainStartsAfterHandover,`Pass 4 scrollable rental tools start below the fixed pickup details at ${width}px: ${JSON.stringify(cancellation)}`);
      assert(cancellation.submitHeight>=40&&cancellation.submitReachable,`Pass 4 cancellation action is reachable by scrolling only the chat pane at ${width}px: ${JSON.stringify(cancellation)}`);
      assert(cancellation.policyLength < 150&&cancellation.afterCollapsed,`Pass 4 cancellation choice stays concise with next-step detail collapsed at ${width}px: ${JSON.stringify(cancellation)}`);
      assert(cancellation.formHeight <= 480,`Pass 4 cancellation form is compact enough for the chat panel at ${width}px: ${JSON.stringify(cancellation)}`);
      if(width<1024) assert(cancellation.mainOverflow==='auto'||cancellation.mainScrollHeight<=cancellation.mainHeight,`Pass 4 cancellation details can scroll at ${width}px`);
      fs.writeFileSync(`/tmp/dbc-renter-audit-${width}x${height}-pass4-cancellation.png`,Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
    }
    await client.cmd("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await client.cmd("Emulation.setUserAgentOverride",{userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",platform:"iPhone"});
    await client.evaluate(`try{localStorage.clear()}catch{}`);
    await client.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/`});
    for(let i=0;i<100&&!await client.evaluate(`!!document.querySelector('[data-conversation-scope]')`);i++)await wait(50);
    await wait(200);
    const iosPrompt=await client.evaluate(`(()=>{const card=document.querySelector('[aria-label="Chat notifications"]'),icon=card?.querySelector('[class*="notificationShareIcon"]'),buttons=card?[...card.querySelectorAll('button')]:[];return{copy:card?.innerText??null,hasShareIcon:!!icon&&icon.getBoundingClientRect().width>0,buttonHeights:buttons.map(button=>button.getBoundingClientRect().height),documentWidth:document.documentElement.scrollWidth}})()`);
    assert(iosPrompt?.copy.includes("Add to Home Screen")&&iosPrompt.hasShareIcon&&iosPrompt.buttonHeights.length===2&&iosPrompt.buttonHeights.every(height=>height>=44)&&iosPrompt.documentWidth<=390,`Pass 5 iPhone chat prompt shows its Safari Share symbol and usable actions: ${JSON.stringify(iosPrompt)}`);
    fs.writeFileSync("/tmp/dbc-renter-audit-ios-notification.png",Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
    console.log("PASS renter chat mobile audit: 320x640, 320x667, 390x844, 430x932, 768x900 plus iPhone Safari instructions; keyboard/touch actions, alert prompt, real listing photos, cancellation and extension flows; synthetic data only.");
  } finally {
    if(client){client.close();try{await fetch(`${process.env.DBC_CDP_URL}/json/close/${client.tabId}`)}catch{}}
    if(chrome&&chrome.exitCode===null){const done=new Promise(resolve=>chrome.once("exit",resolve));chrome.kill();await done;}
    server.close(); await wait(80); await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
