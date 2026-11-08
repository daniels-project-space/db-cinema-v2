const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");
const postcss = require("postcss");

const root = path.resolve(__dirname, "..");
const connectSource = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", connectSource.slice(0, connectSource.indexOf("const { ConvexHttpClient }")) + "\nreturn connect;")(require);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const cameraListingPhoto = "https://hygglo.imgix.net/products/73d7d0_sony-fx-3-4k-mirrorless-full-frame-cinema-camera-audio-handle-24-70mm-f28-g-master-zoom-lens-set-gmaster-g-master-sony-fx3-fx3-a7siii-a7s-iii-a7-siii-alpha-camera-cannon-nikon-fuji.jpg?cs=strip&fm=pjpg&q=70";
const syntheticAvatarSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#42616a"/><stop offset="1" stop-color="#263c42"/></linearGradient></defs><rect width="80" height="80" fill="url(#bg)"/><path d="M10 80c3-18 14-27 30-27s27 9 30 27" fill="#b77c5d"/><path d="M25 35c0-16 7-24 16-24s16 8 16 24v9c-3 10-9 16-16 16s-13-6-16-16z" fill="#d9ad8c"/><path d="M24 32c0-17 7-25 18-25 12 0 18 9 16 27l-4-7c-6 1-13-1-21-6-1 7-4 11-9 14z" fill="#292627"/><path d="M32 39h2m12 0h2" stroke="#483731" stroke-width="2" stroke-linecap="round"/><path d="M35 47c3 2 7 2 10 0" fill="none" stroke="#9b5f50" stroke-width="1.5" stroke-linecap="round"/></svg>');
const lensListingPhoto = "https://hygglo.imgix.net/fat-llama/products/gmaster-lens-sony-2470mm-f28-21919134.jpeg?cs=strip&fm=pjpg&q=70";
const accounts = [
  { id: "account-jordan", email: "jordan@example.invalid", name: "Jordan Blake", tier: "pro", override: "automatic", encoreOverride: "3", blocked: false, blockedReason: "", hasSubscription: true, subscriptionTier: "pro", verified: true, verifiedUntil: Date.UTC(2030, 1, 1), avatarUrl: "/synthetic-avatar.svg", visualTier: "subscriber" },
  { id: "account-riley", email: "riley@example.invalid", name: "Riley Chen", tier: "standard", override: "automatic", encoreOverride: "automatic", blocked: false, blockedReason: "", hasSubscription: false, subscriptionTier: null, verified: false, avatarUrl: null, visualTier: "guest" },
  { id: "account-casey", email: "casey@example.invalid", name: "Casey Morgan", tier: "standard", override: "automatic", encoreOverride: "automatic", blocked: false, blockedReason: "", hasSubscription: false, subscriptionTier: null, verified: true, verifiedUntil: Date.UTC(2030, 1, 1), avatarUrl: null, visualTier: "guest" },
  { id: "account-taylor", email: "taylor@example.invalid", name: "Taylor Reed", tier: "standard", override: "automatic", encoreOverride: "automatic", blocked: false, blockedReason: "", hasSubscription: false, subscriptionTier: null, verified: false, avatarUrl: null, visualTier: "guest" },
  { id: "account-alex", email: "alex@example.invalid", name: "Alex Park", tier: "standard", override: "automatic", encoreOverride: "automatic", blocked: false, blockedReason: "", hasSubscription: false, subscriptionTier: null, verified: true, verifiedUntil: Date.UTC(2030, 1, 1), avatarUrl: null, visualTier: "guest" },
];
const rentals = [
  { id: "booking-camera", status: "confirmed", total: 180, title: "Sony FX3 camera", start: Date.UTC(2030, 0, 2), end: Date.UTC(2030, 0, 4), imageSources: [cameraListingPhoto], quantity: 3, items: [{title:"Sony FX3 camera",qty:1,heroImage:cameraListingPhoto,imageSources:[]},{title:"Sony 24–70mm lens",qty:2,imageSources:[lensListingPhoto]}] },
  { id: "booking-lens", status: "returned", total: 80, title: "Sony 24–70mm lens", start: Date.UTC(2029, 11, 20), end: Date.UTC(2029, 11, 22), imageSources: [lensListingPhoto], quantity: 1 },
  { id: "booking-review", status: "pending_verification", idVerifyStatus: "manual_review", verificationProvider: "didit", total: 45, title: "Verification case", start: Date.UTC(2030, 0, 5), end: Date.UTC(2030, 0, 6), imageSources: [cameraListingPhoto], quantity: 1 },
];
const conversations = [
  { id: "thread-support", bookingId: null, lastMessage: "Can you help with my next shoot?", updatedAt: Date.UTC(2029, 11, 28), unread: 2 },
  { id: "thread-camera", bookingId: "booking-camera", lastMessage: "I need to extend by one day.", updatedAt: Date.UTC(2029, 11, 27), unread: 1 },
  { id: "thread-lens", bookingId: "booking-lens", lastMessage: "Thanks, everything arrived safely.", updatedAt: Date.UTC(2029, 11, 22), unread: 0 },
  { id: "thread-review", bookingId: "booking-review", lastMessage: "Please check my verification.", updatedAt: Date.UTC(2029, 11, 29), unread: 0 },
];

function detail(accountId) {
  const account = accounts.find(row => row.id === accountId) ?? accounts[0];
  return {
    id: account.id, name: account.name, phone: "+44 7700 900123", address: null, createdAt: Date.UTC(2029, 1, 1),
    hasBillingCustomer: account.id === "account-jordan",
    membershipStatus: account.hasSubscription ? "active" : null, membershipActive: account.hasSubscription,
    paidThrough: account.hasSubscription ? Date.UTC(2030, 1, 1) : null, cancelAtPeriodEnd: false,
    verificationExpiresAt: account.verified ? Date.UTC(2030, 1, 1) : null,
    credit: 12, refundCredit: 5, rentals: account.id === accounts[0].id ? rentals : [], rentalsMore: false,
    conversations: account.id === accounts[0].id ? conversations : [], notes: [],
  };
}

const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {AccountAdmin} from './src/components/admin/AccountAdmin';
import {AccountDocuments as RealDocuments} from './src/components/admin/AccountDocuments';
import {AccountCreditPanel as RealCreditPanel} from './src/components/admin/AccountCreditPanel';
import {ManagementShell} from './src/components/management/ManagementShell';
import {RentalConversation} from './src/components/rentals/RentalConversation';
import rentalConversationStyles from './src/components/rentals/RentalConversation.module.css';
import {RenterChat} from './src/components/RenterChat';
import {RenterRentalTools} from './src/components/rentals/RenterRentalTools';
window.__mutationCalls=[]; window.__lastDirectoryArgs=null; window.__lastSearchArgs=null; window.addEventListener('dbc:request-renter-notification-status',()=>window.dispatchEvent(new CustomEvent('dbc:renter-notification-status',{detail:location.search.includes('notifications-active=1')?'active':'inactive'})));
window.__archives=location.search.includes('retention-review=1')?[{_id:'archive-fixture',bookingId:'booking-fixture',status:'complete',source:'didit',retention:{viewable:false,needsReview:true,expiresAt:null,activeRentals:0,openCases:0,status:'unknown-closure',reviewDetails:{kind:'case-chronology',bookingId:'linked-booking-fixture',caseId:'case-fixture',openedAt:1700000000000,closedAt:null}},documents:[{id:'document-fixture',kind:'id_front',contentType:'image/jpeg',size:2048,savedAt:Date.now(),available:false}],copiesReady:false,readProofExpiresAt:null}]:[{_id:'archive-fixture',bookingId:'booking-fixture',status:'complete',source:'didit',retentionHoldReason:'Open insurance claim',retentionHoldRevision:7,retention:{viewable:true,expiresAt:null,activeRentals:0,openCases:0,status:'manual-hold'},documents:[],copiesReady:false,readProofExpiresAt:null}];
const renter = location.search.includes('renter=');
    createRoot(document.getElementById('root')).render(location.search.includes('credit=1') ? <RealCreditPanel token="synthetic-admin" accountId="account-jordan"/> : location.search.includes('documents=1') ? <RealDocuments token="synthetic-admin" accountId="account-jordan" onRental={id=>window.__investigateRental=id}/> : renter ? <ManagementShell role="renter" title="Messages" name="Jordan Blake" active="chat" nav={[{key:'rentals',label:'My rentals'},{key:'chat',label:'Messages'}]} onNavigate={key=>window.__navigation=key}>{location.search.includes('extension=1') ? <div className={rentalConversationStyles.renterInbox}><RentalConversation token="synthetic-renter" bookingId="booking-camera" title="Sony FX3 camera" stage="confirmed" renterWorkspace bookingSummary={{dates:'2 Jan 2030 – 4 Jan 2030',count:2,items:[{title:'Sony FX3 camera',qty:1,imageSources:[${JSON.stringify(cameraListingPhoto)}]},{title:'Sony 24–70mm lens',qty:2,imageSources:[${JSON.stringify(lensListingPhoto)}]}]}} tools={<RenterRentalTools token="synthetic-renter" bookingId="booking-camera" />} /></div> : location.search.includes('renter=2') ? <RentalConversation token="synthetic-renter" title="Account support" stage="Support" renterWorkspace workspaceIdentity={{name:'Private customer',privatePortrait:<span data-private-portrait/>}} onStar={()=>{}} /> : <div id="renter-chat" className="tab-in mt-6"><RenterChat focusBookingId="general"/></div>}</ManagementShell> : <ManagementShell role="admin" title="Customers & members" name="DB Cinema team" active="accounts" nav={[{key:'overview',label:'Dashboard',icon:'dashboard'},{key:'bookings',label:'Rentals',icon:'rentals'},{key:'accounts',label:'Customers & members',icon:'people'},{key:'inbox',label:'Messages',icon:'messages'}]} onNavigate={key=>window.__navigation=key} actions={<><button aria-label="Notifications">◌</button><button>Lock</button></>}><AccountAdmin token="synthetic-admin" onConversation={(accountId,bookingId)=>window.__openedFullInbox={accountId,bookingId}}/></ManagementShell>);
`;
const mocks = {
  name: "customer-workspace-synthetic-data",
  setup(build) {
    build.onResolve({ filter: /^(next\/(link|image)|convex\/react|@cvx\/_generated\/api|\.\/account\/AccountProvider|\.\/AccountDocuments|@\/components\/admin\/AccountCreditPanel|@\/components\/admin\/CustomerInvite|@\/components\/management\/AdminInvoiceLibrary|@\/components\/account\/BookingReview|\.\/(RentalAdditionApproval|RentalPricePanel|SavedCardCharges|RentalVerificationSummary|RentalDeliveryQuoteApproval))$/ }, args => ({ path: args.path, namespace: "customer-fixture" }));
    build.onLoad({ filter: /.*/, namespace: "customer-fixture" }, args => {
      if (args.path === "next/link") return { loader: "jsx", resolveDir: root, contents: `import React from 'react'; export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}` };
      if (args.path === "next/image") return { loader: "jsx", resolveDir: root, contents: `import React from 'react';export default function Image(props){return <img {...props}/>} ` };
      if (args.path === "./account/AccountProvider") return { loader: "js", contents: `export const useAccount=()=>({token:'synthetic-renter'});` };
      if (args.path === "convex/react") return { loader: "jsx", contents: `
        export const useQuery=(ref,args)=>{
          if(args==='skip')return undefined;
          if(ref==='chatAttachments.availability')return true;
          if(ref==='privateVerificationPortrait.availability')return true;
          if(ref==='verificationArchive.accountDocuments')return window.__archives;
          if(ref==='accountAdmin.directoryAccess')return true;
          if(ref==='rentalExtensions.state')return {status:'confirmed',locked:false,pickupTime:'09:00',returnTime:'17:00',items:[{index:0,listingId:'listing-camera',slug:'sony-fx3',title:'Sony FX3 camera',qty:1,start:Date.UTC(2030,0,2),end:Date.UTC(2030,0,4),returnTime:'17:00',imageSources:[${JSON.stringify(cameraListingPhoto)}]},{index:1,listingId:'listing-lens',slug:'sony-24-70',title:'Sony 24–70mm lens',qty:1,start:Date.UTC(2030,0,2),end:Date.UTC(2030,0,4),returnTime:'17:00',imageSources:[${JSON.stringify(lensListingPhoto)}]}],requests:[],paymentsEnabled:true};
          if(ref==='rentalExtensions.quote')return {available:true,partialAvailability:true,availableIndexes:[0],unavailableItems:[{lineIndex:1,title:'Sony 24–70mm lens',qty:1,reason:'Unavailable for the extra dates'}],items:[{lineIndex:0,listingId:'listing-camera',title:'Sony FX3 camera',qty:1,start:Date.UTC(2030,0,5),end:Date.UTC(2030,0,6),lineTotal:24.68}],priceDelta:24.68,baseLines:'fixture-base',benefitSaving:0};
          if(ref==='cartReplacements.forCart')return {'1':[{slug:'fx6-alt',title:'Sony FX6 camera',heroImage:${JSON.stringify(cameraListingPhoto)},imageSources:[],total:68}]};
          if(ref==='rentalOperations.details')return {_id:args.bookingId,status:args.bookingId==='booking-review'?'pending_verification':'confirmed',lineItems:[{title:'Sony FX3 camera',listingId:'listing-camera',qty:1,start:Date.UTC(2030,0,2),end:Date.UTC(2030,0,4),lineTotal:180}],rentalRefunds:[],fulfilment:'pickup',guestName:'Jordan Blake',guestEmail:'jordan@example.invalid',idVerifyStatus:args.bookingId==='booking-review'?'manual_review':'verified',verificationProvider:'didit',verificationNote:args.bookingId==='booking-review'?'A required check did not pass.':undefined,diditSessionId:'synthetic-session',total:180,depositAmount:0,cancellationKind:'full_refund',stripePaymentIntentId:'pi_synthetic',controlsSnapshot:'synthetic-snapshot'};
          if(ref==='rentalRequests.context')return {status:'confirmed',start:Date.UTC(2030,0,2),end:Date.UTC(2030,0,4),items:[{index:0,title:'Sony FX3 camera',start:Date.UTC(2030,0,2),end:Date.UTC(2030,0,4),qty:1,heroImage:${JSON.stringify(cameraListingPhoto)},imageSources:[${JSON.stringify(cameraListingPhoto)}]},{index:1,title:'Sony 24–70mm lens',start:Date.UTC(2030,0,2),end:Date.UTC(2030,0,4),qty:1,heroImage:${JSON.stringify(lensListingPhoto)},imageSources:[${JSON.stringify(lensListingPhoto)}]}],cancellationKind:'full_refund',cancellationFullRefundDays:7,cancellationTermsVersion:'2026-11-v21',direct:true,selfService:true,locked:false};
          if(ref==='cancellationRecovery.renterStatus')return null;
          if(ref==='rentalOperations.renterReschedulePreview')return {ok:true,start:args.start,end:args.start+2*86400000,controlsSnapshot:'synthetic-snapshot'};
          if(ref==='accountAdmin.searchMessages'){window.__lastSearchArgs=args;return {items:[],truncated:false};}
          if(ref==='accountCredits.adminHistory')return [{id:'credit-fixture',amount:5,reason:'Booking adjustment',createdAt:Date.UTC(2030,0,1),expiresAt:Date.UTC(2031,0,1)}];
          if(ref==='accountCredits.grantStatus')return {revision:0,latest:null,receipt:null};
          if(ref==='accountAdmin.detail')return window.__details[args.accountId]??null;
          if(ref==='membershipInvoiceReviews.adminList')return args.accountId==='account-jordan'?[{invoiceId:'in_synthetic',reason:'price_snapshot',createdAt:Date.UTC(2030,0,1),retryAt:null}]:[];
          if(ref==='membershipRefundJobs.adminList')return args.accountId==='account-jordan'?[{invoiceId:'in_synthetic',refundId:'re_synthetic',updatedAt:Date.UTC(2030,0,1)}]:[];
          if(ref==='accountAdmin.verificationReviews')return {items:(window.__details[args.accountId]?.rentals??[]).filter(rental=>rental.verificationProvider==='didit'&&rental.idVerifyStatus==='manual_review'&&['pending_verification','confirmed','active'].includes(rental.status)),more:false};
          if(ref==='accountAdmin.possibleRestrictedIdentityMatches')return {matches:args.bookingId==='booking-camera'?[{id:'restricted-fixture',name:'Restricted fixture',email:'restricted@example.invalid',blockedReason:'Prior issue'}]:[],more:false};
          if(ref==='accountAdmin.history')return [];
          if(ref==='accountAdmin.directoryMetrics')return args.accountIds.map(id=>({id,activeRentals:id==='account-jordan'?1:0,activeRentalsMore:false,credit:12,unreadMessages:id==='account-jordan'?3:id==='account-riley'?1:0,lastMessage:({'account-jordan':'Can you confirm the camera kit?','account-riley':"Thanks! I will extend the rental through Friday.",'account-casey':'Do you have a matte box in stock?','account-taylor':'Great — confirmed for pickup at 9 AM.','account-alex':'What are the rental options for the new camera body?'})[id]??null,visualTier:id==='account-jordan'?'subscriber':id==='account-riley'?'encore2':id==='account-casey'?'encore1':'guest',encoreLevel:id==='account-riley'?2:id==='account-casey'?1:id==='account-taylor'?null:0}));
          if(ref==='rentalChat.messages'&&location.search.includes('extension=1'))window.__extensionImageSources=[${JSON.stringify(cameraListingPhoto)}];
          if(ref==='rentalChat.messages'&&location.search.includes('extension=1'))return {notificationScope:'fixture-renter-account',page:[{_id:'gaffer-extension',sender:'bot',text:'I can check an extension for this rental.',meta:{extensionOffer:{items:[{index:0,title:'Sony FX3 camera',qty:1,end:'2030-01-04',returnTime:'17:00',imageSources:[${JSON.stringify(cameraListingPhoto)}]}]}},at:Date.UTC(2029,11,28)+1000},{_id:'renter-extension',sender:'renter',text:'Can I keep the kit longer?',at:Date.UTC(2029,11,28)}],isDone:true,continueCursor:'',escalated:false,replyState:{awaitingTeam:false,awaitingReply:false,renterAt:Date.UTC(2029,11,28)},quickReplies:[],renter:{name:'Jordan',phone:'+44 7700 900123',photo:null}};
          if(ref==='rentalChat.messages'){
            window.__rentalTargets.push({accountId:args.accountId??null,bookingId:args.bookingId??null});
            return {notificationScope:args.admin?null:"fixture-renter-account",page:[...(location.search.includes('catalogue=1')?[{_id:'gaffer-catalogue',sender:'bot',text:'Here is an FX3 option.',meta:{catalogueItems:[{title:'Sony FX3 camera',slug:'sony-fx3',category:'Cameras',daily:48,days:2,perDay:44,total:88,availability:'available',dates:'2030-01-02 → 2030-01-04'}]},at:Date.UTC(2029,11,28)+1000}]:[]),...(location.search.includes('handoff=1')?[{_id:'gaffer-offer',sender:'bot',text:'I can ask the team to help.',meta:{offerHuman:true},at:Date.UTC(2029,11,28)+2000}]:[]),...(location.search.includes('stale=1')?[{_id:'new-renter-message',sender:'renter',text:'Another question',at:Date.UTC(2029,11,28)+3000}]:[]),...(location.search.includes('reply=1')?[{_id:location.search.includes('other=1')?'other-reply':'gaffer-first-answer',sender:'bot',text:'Yes, I can help with that.',at:Date.UTC(2029,11,28)+1000}]:[]),...(location.search.includes('visual=1')&&args.admin?[{_id:'visual-renter-1',accountId:args.accountId,bookingId:args.bookingId??null,sender:'renter',text:'Could you confirm availability for the cine prime set this week?',at:Date.UTC(2029,11,28)-120000},{_id:'visual-owner-1',accountId:args.accountId,bookingId:args.bookingId??null,sender:'owner',text:'Yes, the set is available. Would you like me to reserve it for your upcoming shoot?',at:Date.UTC(2029,11,28)-60000}]:[]),{_id:'message-'+(args.bookingId??'support'),accountId:args.accountId,bookingId:args.bookingId??null,sender:'renter',text:'Can you confirm the kit for my next shoot?',at:Date.UTC(2029,11,28)}],isDone:true,continueCursor:'',escalated:location.search.includes('team=1'),replyState:{awaitingTeam:true,awaitingReply:false,renterAt:Date.UTC(2029,11,28)},quickReplies:[],renter:{name:'Jordan',phone:'+44 7700 900123',photo:null}};
          }
          if(ref==='privateVerificationPortrait.selected')return args.accountId==='account-casey'?{documentId:'synthetic-private-selfie'}:null;
          return undefined;
        };
        export const usePaginatedQuery=(ref,args)=>{
          if(ref==='accountCredits.history')return {results:[{id:'credit-fixture',amount:5,remaining:5,reason:'Booking adjustment',createdAt:Date.UTC(2030,0,1),expiresAt:Date.UTC(2031,0,1),status:'active'}],status:'Exhausted',loadMore:()=>{}};
          if(ref==='rentalChat.minePage'&&args!=='skip')return {results:[
            {_id:'renter-camera',status:'confirmed',idVerifyStatus:'verified',paidConfirmedAt:Date.UTC(2029,11,28),verificationExpiresAt:Date.UTC(2030,1,1),start:Date.UTC(2030,0,2),end:Date.UTC(2030,0,4),handoverDetails:{phone:'+44 7933 019849',pickupAddress:'The Grand Building, Trafalgar Square, London WC2N 5EJ',returnAddress:'The Grand Building, Trafalgar Square, London WC2N 5EJ',pickupInstructions:'Please meet outside Waterstones at Trafalgar Square.',fulfilment:'pickup'},items:[{title:'Sony FX3 camera',imageSources:[${JSON.stringify(cameraListingPhoto)}]},{title:'Sony 24–70mm lens',imageSources:[${JSON.stringify(lensListingPhoto)}]}],unreadRenter:2},
            {_id:'renter-lens',status:'returned',start:Date.UTC(2029,11,20),end:Date.UTC(2029,11,22),items:[{title:'Sony 24–70mm lens',imageSources:[${JSON.stringify(lensListingPhoto)}]}],unreadRenter:0}
          ],status:'Exhausted',loadMore:()=>{}};
          if(args==='skip'||ref==='rentalRequests.list'||ref==='catalog.adminListListings')return {results:[],status:'Exhausted',loadMore:()=>{}};
          window.__lastDirectoryArgs=args;const search=(args?.search??'').toLocaleLowerCase('en-GB');const page=window.__accounts.filter(account=>!search||\`${'${account.name} ${account.email}'}\`.toLocaleLowerCase('en-GB').includes(search));return {results:page,status:'Exhausted',loadMore:()=>{}};
        };
        const mutate=ref=>async args=>{if(ref!=='chatAttachments.availability')window.__mutationCalls.push({ref,args});if(ref==='accountAdmin.setStarred'&&window.__deferStar)return new Promise((resolve,reject)=>{window.__rejectStar=reject});if(ref==='accountAdmin.setStarred'&&window.__failStar)throw Error('Simulated failure');if(ref==='didit.refreshProgress'&&window.__rejectDiditRefresh||ref==='accountCredits.grantAdmin'&&window.__creditFail)throw Error('Simulated uncertain response');return ref==='chatAttachments.availability'?true:ref==='checkout.adminBillingPortal'?{url:'https://billing.stripe.com/p/session/fixture'}:ref==='checkout.adminRetryMembershipInvoice'?{state:'review'}:ref==='checkout.adminInspectMembershipInvoice'?{invoice:{id:'in_synthetic',status:'paid',amountPaidPence:4900,currency:'gbp',createdAt:Date.UTC(2030,0,1)},receipt:{creditPence:4900,bonusPence:0,revokedPence:500,paidMembershipPence:4900,createdAt:Date.UTC(2030,0,1)}}:ref==='checkout.refundRental'?{amount:15,status:'succeeded'}:ref==='didit.refreshProgress'?{status:'unchanged'}:ref==='accountCredits.grantAdmin'?{amount:args.amount,expiresAt:Date.UTC(2030,1,1)}:{ok:true};};
        export const useMutation=mutate,useAction=mutate,useConvex=()=>({query:async()=>null});
      ` };
      if (args.path === "@cvx/_generated/api") return { loader: "js", contents: `export const api=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,name)=>String(group)+'.'+String(name)})});` };
      const mockComponents = `
        import React from 'react';
        export function AccountDocuments({onBack}){return <section><button onClick={onBack}>Back from documents</button></section>}
        export function AccountDocumentSummary({verified}){return <p>{verified?'Verification passed':'Verification pending'}</p>}
        export function SmartImage({className='',alt='',src}){return <span className={className} role="img" aria-label={alt||'Renter image'} data-image-source={src??''} />}
        export function AccountCreditPanel(){return <section>Existing credit controls</section>}
        export function CustomerInvite(){return <button type="button">Add customer</button>}
        export function AdminInvoiceLibrary(){return <section>Existing invoices</section>}
        export function RentalAdditionApproval(){return null}
        export function RentalPricePanel(){return null}
        export function RentalExtensionPanel(){return null}
        export function SavedCardCharges(){return null}
        export function BookingReview(){return null}
        export function RentalVerificationSummary(){return null}
        export function RentalDeliveryQuoteApproval(){return null}
        export function ChatAvatar({sender,name,photo}){return <span data-avatar-sender={sender} data-avatar-name={name??''} data-avatar-photo={photo??''} className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-violet-300/15 text-xs font-semibold text-violet-200" aria-hidden="true">{sender==='owner'?'DB':name?.trim()[0]?.toUpperCase() ?? 'R'}</span>}
        export function GafferIcon(){return <span aria-hidden="true" />}
      `;
      return { loader: "jsx", resolveDir: root, contents: mockComponents };
    });
  },
};

(async () => {
  const imageBundle = await esbuild.build({ entryPoints: [path.join(root, "convex/lib/catalogImages.ts")], bundle: true, write: false, platform: "node", format: "cjs" });
  const imageModule = { exports: {} };
  new Function("module", "exports", imageBundle.outputFiles[0].text)(imageModule, imageModule.exports);
  assert.deepEqual(imageModule.exports.listingRentalImages({ reviewedImageUrls: ["https://cdn.example.invalid/listing-hero.jpg"], r2Images: ["https://cdn.example.invalid/listing-backup.jpg"], sourceImages: ["https://cdn.example.invalid/stale-source-variant.jpg", "//invalid.example/image.jpg", "/gear/lens.svg"], gallery: ["https://cdn.example.invalid/old-gallery.jpg"] }), ["https://cdn.example.invalid/listing-hero.jpg", "https://cdn.example.invalid/listing-backup.jpg"], "Rental cards use the exact listing's reviewed real photo and safe image fallback, never a stale source variant, unsafe URL or SVG drawing");
  assert.deepEqual(imageModule.exports.listingRentalImages({ reviewedImageUrls: [], r2Images: ["https://cdn.example.invalid/hidden-r2.jpg"], sourceImages: ["https://cdn.example.invalid/hidden-source.jpg"], gallery: ["/images/catalog.jpg"] }), [], "An explicitly cleared public gallery never leaks stale or unrelated image variants into a rental");
  const imageSources = imageModule.exports.listingImages({ r2Images: ["https://cdn.example.invalid/r2.jpg"], sourceImages: ["https://cdn.example.invalid/source.jpg", "//invalid.example/image.jpg"], gallery: ["https://cdn.example.invalid/source.jpg", "/images/catalog.jpg"] });
  assert.deepEqual(imageSources, ["https://cdn.example.invalid/r2.jpg", "https://cdn.example.invalid/source.jpg", "/images/catalog.jpg"], "A listing without an explicit reviewed-image override keeps safe migrated and gallery fallbacks without duplicates");
  assert.deepEqual(imageModule.exports.listingImages({ reviewedImageUrls: ["https://cdn.example.invalid/reviewed.jpg"], r2Images: ["https://cdn.example.invalid/r2.jpg"] }), ["https://cdn.example.invalid/reviewed.jpg", "https://cdn.example.invalid/r2.jpg"], "Reviewed photos remain preferred while valid fallback photos remain available");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-customer-workspace-"));
  const bundle = await esbuild.build({ stdin: { contents: source, resolveDir: root, loader: "tsx" }, bundle: true, write: false, outdir: path.join(directory, "out"), platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_CONVEX_URL": '"https://fixture.convex.cloud"', "process.env.NEXT_PUBLIC_CONVEX_SITE_URL": '"."', "process.env": "{}" }, plugins: [mocks] });
  const globalCss = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const css = `${globalCss.css}\n${bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? ""}`;
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js"))?.text;
  assert(script, "The real AccountAdmin component bundles");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="margin:0;background:#111;color:#eee"><main id="root"></main><script>window.__errors=[];window.addEventListener('error',event=>window.__errors.push(event.error?.stack||event.message));window.__accounts=${JSON.stringify(accounts)};window.__details=${JSON.stringify(Object.fromEntries(accounts.map(account=>[account.id,detail(account.id)])))};window.__rentalTargets=[];</script><script src="/bundle.js"></script></body></html>`;
  const server = http.createServer((request, response) => {
    if (request.url === "/admin-private-portrait" && request.method === "POST") { response.writeHead(request.headers.authorization === "Bearer synthetic-admin" ? 200 : 403, { "Content-Type": "image/svg+xml" }); response.end(syntheticAvatarSvg); return; }
    const files = { "/": ["text/html", html], "/style.css": ["text/css", css], "/bundle.js": ["text/javascript", script], "/synthetic-avatar.png": ["image/png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64")], "/db-cinema-aperture-blue.png": ["image/png", fs.readFileSync(path.join(root, "public/db-cinema-aperture-blue.png"))], "/arri-deconstruct-poster.jpg": ["image/jpeg", fs.readFileSync(path.join(root, "public/arri-deconstruct-poster.jpg"))] };
    files["/synthetic-avatar.svg"] = ["image/svg+xml", syntheticAvatarSvg];
    const item = files[new URL(request.url, "http://localhost").pathname]; response.writeHead(item ? 200 : 404, { "Content-Type": item?.[0] ?? "text/plain" }); response.end(item?.[1] ?? "Not found");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = path.join(directory, "chrome-profile");
  const debuggingPort = process.env.CHROME_DEBUG_PORT || "0";
  const attachedBrowser = !!process.env.DBC_CDP_URL;
  const chrome = attachedBrowser ? null : spawn(process.env.CHROME_BIN || "/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${debuggingPort}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let client;
  try {
    let port = process.env.CHROME_DEBUG_PORT || (attachedBrowser ? new URL(process.env.DBC_CDP_URL).port : undefined); for (let attempt = 0; !port && attempt < 100; attempt++) { try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port, "A headless Chrome endpoint is available for the isolated UI fixture"); if (!attachedBrowser) process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    client = await connect(); await client.cmd("Page.enable"); await client.cmd("Runtime.enable");
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?visual=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-testid=admin-account-action-rail]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=admin-account-action-rail]")'), true, "The real account action rail renders");
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=admin-customer-conversation-pane] [data-testid=rental-gaffer-gear-help]")'), false, "The renter-facing gear assistant shortcut stays out of the admin workspace");
    for (const width of [1500, 1350, 1200, 1101, 1100, 768, 320]) {
      await client.cmd('Emulation.setDeviceMetricsOverride', {width, height:900, deviceScaleFactor:1, mobile:width < 768}); await wait(60);
      const navVisible = await client.evaluate(`getComputedStyle(document.querySelector('[data-testid="admin-mobile-workspace-nav"]')).display !== 'none'`);
      assert.equal(navVisible, width <= 1100, `The mobile workspace switch appears only when the layout stacks at ${width}px`);
      if(width <= 1100) await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-mobile-workspace-nav"] button')].find(button=>button.textContent.includes('Profile')).click()`);
      const summaryLayout = await client.evaluate(`(()=>[...document.querySelectorAll('[data-testid="admin-account-summary"] > button')].map(button=>{const label=button.querySelector('span')?.getBoundingClientRect(),value=button.querySelector('strong')?.getBoundingClientRect(),bounds=button.getBoundingClientRect();return {name:button.textContent,labelLeft:label?.left,labelRight:label?.right,labelTop:label?.top,labelBottom:label?.bottom,valueLeft:value?.left,valueRight:value?.right,valueTop:value?.top,valueBottom:value?.bottom,rowRight:bounds.right}}))()`);
      assert.equal(summaryLayout.length,2,`Account summary combines access levels without repeating a separate Encore entry at ${width}px`);
      for (const row of summaryLayout) { assert(row.labelRight <= row.valueLeft || row.valueRight <= row.labelLeft || row.labelBottom <= row.valueTop || row.valueBottom <= row.labelTop, `Account summary label and value do not overlap at ${width}px: ${row.name}`); assert(row.valueRight <= row.rowRight, `Account summary values stay within the rail at ${width}px: ${row.name}`); }
      if(width===1200){const mediumWorkspace=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync("/tmp/dbc-customer-workspace-medium.png",Buffer.from(mediumWorkspace.data,"base64"));}
      if(width===320){const memberProfileScreenshot=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync("/tmp/dbc-customer-workspace-mobile-profile.png",Buffer.from(memberProfileScreenshot.data,"base64"));}
      if(width <= 1100) await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-mobile-workspace-nav"] button')].find(button=>button.textContent.includes('Customers')).click()`);
      const filterActions = await client.evaluate(`(()=>{const row=document.querySelector('[data-testid="admin-account-filter-actions"]'),clear=row?.querySelector('button')?.getBoundingClientRect(),verification=row?.querySelector('summary')?.getBoundingClientRect();return clear&&verification?{clearRight:clear.right,verificationLeft:verification.left,clearCenter:(clear.top+clear.bottom)/2,verificationCenter:(verification.top+verification.bottom)/2}:null})()`);
      assert(filterActions && filterActions.clearRight <= filterActions.verificationLeft && Math.abs(filterActions.clearCenter-filterActions.verificationCenter)<3, `Filter actions remain separated and aligned at ${width}px`);
      if(width===320){const mobileWorkspace=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync("/tmp/dbc-customer-workspace-local-mobile.png",Buffer.from(mobileWorkspace.data,"base64"));}
    }
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-row"]')].find(row=>row.textContent.includes('Jordan Blake')).click()`); await wait(120);
    assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('[data-testid="admin-customer-directory"]')).display`), 'none', 'Selecting a customer takes the narrow layout directly to their conversation');
    const mobileChatLayout = await client.evaluate(`(()=>{const pane=document.querySelector('[data-testid="admin-customer-conversation-pane"]'),rect=pane?.getBoundingClientRect();return {display:pane&&getComputedStyle(pane).display,height:rect?.height,viewport:innerHeight}})()`);
    assert(mobileChatLayout.display !== 'none' && mobileChatLayout.height >= 440 && mobileChatLayout.height < mobileChatLayout.viewport, `The conversation uses the phone viewport without pushing the composer below the fold: ${JSON.stringify(mobileChatLayout)}`);
    const mobileChatScreenshot = await client.cmd("Page.captureScreenshot", {format:"png"}); fs.writeFileSync("/tmp/dbc-customer-workspace-mobile-chat.png", Buffer.from(mobileChatScreenshot.data,"base64"));
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-mobile-conversation-tools"] button')].find(button=>button.textContent.includes('Profile')).click()`); await wait(60);
    assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('[data-testid="admin-account-action-rail"]')).display !== 'none'`), true, 'The profile controls remain available in their own narrow-screen view');
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-mobile-workspace-nav"] button')].find(button=>button.textContent.includes('Customers')).click()`); await wait(60);
    assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('[data-testid="admin-customer-directory"]')).display !== 'none'`), true, 'The customer directory remains one tap away from chat and profile');
    await client.cmd('Emulation.setDeviceMetricsOverride', {width:1500,height:900,deviceScaleFactor:1,mobile:false}); await wait(60);
    for (let attempt = 0; attempt < 50 && !await client.evaluate(`document.querySelector('img[src="/arri-deconstruct-poster.jpg"]')?.naturalWidth > 0`); attempt++) await wait(100);
    assert.equal(await client.evaluate(`document.querySelector('img[src="/arri-deconstruct-poster.jpg"]')?.naturalWidth > 0`), true, "The real sidebar image loads in the visual fixture");
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-row]").length'), 5, "The populated directory renders five synthetic customers");
    for (let attempt = 0; attempt < 50 && !await client.evaluate(`document.querySelector('[data-testid="admin-account-row"] img[src="/synthetic-avatar.svg"]')?.naturalWidth > 0`); attempt++) await wait(100);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-account-row"] img[src="/synthetic-avatar.svg"]')?.naturalWidth > 0`), true, 'A customer profile photo loads in the directory');
    assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('[data-testid="admin-account-row"] img[src="/synthetic-avatar.svg"]')).objectFit`), 'cover', 'Customer directory photos fill and crop their round frames');
    for (let attempt = 0; attempt < 50 && !await client.evaluate(`([...document.querySelectorAll('[data-testid="admin-account-row"]')].find(row=>row.textContent.includes('Casey Morgan'))?.textContent.includes('Encore I'))`); attempt++) await wait(50);
    const encoreRows = await client.evaluate(`(()=>{const rows=[...document.querySelectorAll('[data-testid="admin-account-row"]')],read=name=>{const row=rows.find(item=>item.textContent.includes(name));return{label:row?.textContent,glow:row?getComputedStyle(row).boxShadow:null}};return{earnedOne:read('Casey Morgan'),earnedTwo:read('Riley Chen'),guest:read('Alex Park')}})()`);
    assert.match(encoreRows.earnedOne.label, /Encore I/, 'A live earned Encore I appears on the renter row without a manual override');
    assert.notEqual(encoreRows.earnedOne.glow, 'none', 'Earned Encore I receives its silver row treatment');
    assert.match(encoreRows.earnedTwo.label, /Encore II/, 'A live earned Encore II appears on the renter row');
    assert.notEqual(encoreRows.earnedTwo.glow, 'none', 'Earned Encore II receives its silver row treatment');
    assert.equal(encoreRows.guest.glow, 'none', 'Guests keep the clean, unlit row treatment');
    assert.equal(await client.evaluate(`document.querySelector('[data-conversation-scope] header img[src="/synthetic-avatar.svg"]')?.naturalWidth > 0`), true, 'The same profile photo loads in the selected chat header');
    assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('[data-testid="admin-chat-avatar"] img')).objectFit`), 'cover', 'The single selected-chat photo fills and crops its verification ring');
    assert.equal(await client.evaluate(`document.querySelector('[data-conversation-scope] header a[href^="tel:"]')?.getAttribute('href')`), 'tel:+447700900123', 'The chat header offers the selected renter’s real phone number as a direct call');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-chat-phone"]')?.textContent`), '+44 7700 900123', 'The phone number is visible beside the call action');
    await client.cmd('Emulation.setDeviceMetricsOverride', {width:320,height:900,deviceScaleFactor:1,mobile:true}); await wait(80);
    await client.evaluate(`(()=>{const button=[...(document.querySelector('[data-testid="admin-mobile-workspace-nav"]')?.querySelectorAll('button')??[])].find(item=>item.textContent.includes('Chat'));button?.click()})()`); await wait(80);
    const narrowPhone = await client.evaluate(`(()=>{const visible=node=>{const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0},phones=[...document.querySelectorAll('[data-testid="admin-chat-phone"]')].filter(visible),calls=[...document.querySelectorAll('[data-conversation-scope] header a[href^="tel:"]')].filter(visible),phone=phones[0],call=calls[0],bounds=phone?.getBoundingClientRect(),callBounds=call?.getBoundingClientRect();return{visible:!!phone,phoneText:phone?.textContent,callVisible:!!call,phoneCount:phones.length,callCount:calls.length,overlap:!!bounds&&!!callBounds&&bounds.left<callBounds.right&&bounds.right>callBounds.left&&bounds.top<callBounds.bottom&&bounds.bottom>callBounds.top}})()`);
    assert(narrowPhone.visible && narrowPhone.callVisible && !narrowPhone.overlap, `The renter phone and direct call remain visible without overlap on a 320px phone: ${JSON.stringify(narrowPhone)}`);
    fs.writeFileSync('/tmp/dbc-customer-workspace-320-phone.png',Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
    await client.cmd('Emulation.setDeviceMetricsOverride', {width:1500,height:900,deviceScaleFactor:1,mobile:false}); await wait(80);
    await client.evaluate(`([...document.querySelectorAll('[aria-label="Customer conversations"] button')].find(button=>button.textContent.includes('Sony FX3 camera'))).click()`); await wait(100);
    for (let attempt = 0; attempt < 50 && !await client.evaluate(`document.querySelector('[data-conversation-scope]')?.textContent.includes('Can you confirm the kit for my next shoot?')`); attempt++) await wait(100);
    assert.equal(await client.evaluate(`document.querySelector('[data-conversation-scope]')?.textContent.includes('Can you confirm the kit for my next shoot?')`), true, 'The selected conversation is populated before visual capture');
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`Array.from(document.querySelectorAll('[data-testid="rental-items-in-chat"] img')).length === 2 && Array.from(document.querySelectorAll('[data-testid="rental-items-in-chat"] img')).every(image=>image.complete&&image.naturalWidth>0)`); attempt++) await wait(100);
    const bookingImageLayout = await client.evaluate(`(()=>{const card=document.querySelector('[data-testid="rental-items-in-chat"]'),cardRect=card?.getBoundingClientRect(),items=[...(card?.querySelectorAll('[data-rental-item-title]')??[])],images=items.map(item=>item.querySelector('img'));return{count:items.length,titles:items.map(item=>item.textContent.trim()),insideChat:!!card?.closest('.management-conversation-messages'),outsideHeader:!document.querySelector('.bookingStrip [data-rental-item-title]'),noHorizontalOverflow:!!card&&card.scrollWidth<=card.clientWidth+1,cardHeight:cardRect?.height,alts:images.map(image=>image?.alt),sources:images.map(image=>image?.getAttribute('src')),fits:images.map(image=>image&&getComputedStyle(image).objectFit),photoWidths:images.map(image=>image?.getBoundingClientRect().width),widths:items.map(item=>item.getBoundingClientRect().width),positions:items.map(item=>{const rect=item.getBoundingClientRect();return{left:rect.left,top:rect.top}}),loaded:images.every(image=>image?.naturalWidth>0)}})()`);
    assert.equal(bookingImageLayout.count, 2, 'The active rental shows one photo for each distinct listing');
    assert.equal(bookingImageLayout.insideChat, true, 'Listing photos appear in the message timeline rather than as header icons');
    assert.equal(bookingImageLayout.outsideHeader, true, 'The booking header stays clear of miniature product pictures');
    assert(bookingImageLayout.alts.some(alt=>alt.includes('Sony FX3 camera'))&&bookingImageLayout.alts.some(alt=>alt.includes('Sony 24')&&alt.includes('70mm lens')), `The photos identify the actual camera and lens listings: ${JSON.stringify(bookingImageLayout)}`);
    assert(bookingImageLayout.titles.some(title=>title.includes('Sony 24–70mm lens')), `The original listing title keeps its proper 24–70mm typography: ${JSON.stringify(bookingImageLayout.titles)}`);
    assert.equal(new Set(bookingImageLayout.sources).size, 2, 'A multi-item booking does not repeat one listing photo for every item');
    assert(bookingImageLayout.sources.some(source => source === cameraListingPhoto) && bookingImageLayout.sources.some(source => source === lensListingPhoto), `The chat uses the original FX3 and 24–70mm listing image sources, not icon placeholders: ${JSON.stringify(bookingImageLayout.sources)}`);
    assert(bookingImageLayout.positions[0].left < bookingImageLayout.positions[1].left && Math.abs(bookingImageLayout.positions[0].top-bookingImageLayout.positions[1].top) < 4, `The booked listings display side by side in the desktop chat: ${JSON.stringify(bookingImageLayout.positions)}`);
    assert(bookingImageLayout.photoWidths.every(width=>width>=70&&width<=80), `Real product photos stay recognizable in the compact chat cards: ${JSON.stringify(bookingImageLayout)}`);
    assert(bookingImageLayout.cardHeight<=145, `The item photo rail leaves room for conversation history: ${JSON.stringify(bookingImageLayout)}`);
    assert(bookingImageLayout.fits.every(fit => fit === 'contain'), 'Each real listing photo is shown uncropped inside the chat');
    assert(bookingImageLayout.sources.every(source => !/\.svg(?:$|[?#])/i.test(source) && !source.startsWith('data:image/')), 'Equipment cards never render illustrative SVG or data-URI placeholders');
    assert(bookingImageLayout.widths.every(width=>width>=190)&&bookingImageLayout.noHorizontalOverflow&&bookingImageLayout.loaded, `Compact rental photo cards load without clipping or horizontal hiding: ${JSON.stringify(bookingImageLayout)}`);
    await client.cmd('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true}); await wait(100);
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-mobile-workspace-nav"] button')].find(button=>button.textContent.includes('Chat'))?.click()`); await wait(100);
    await client.evaluate(`(()=>{const card=document.querySelector('[data-testid="rental-items-in-chat"]'),messages=card?.closest('.management-conversation-messages');if(messages)messages.scrollTop=messages.scrollHeight;})()`); await wait(100);
    const mobileBookingImageLayout = await client.evaluate(`(()=>{const card=document.querySelector('[data-testid="rental-items-in-chat"]'),composer=document.querySelector('[data-testid="admin-customer-conversation-pane"] footer'),main=card?.closest('.management-conversation-main'),strip=main?.querySelector(':scope > [class*="bookingStrip"]'),messages=card?.closest('.management-conversation-messages'),items=[...(card?.querySelectorAll('[data-rental-item-title]')??[])],images=items.map(item=>item.querySelector('img')),cardRect=card?.getBoundingClientRect(),composerRect=composer?.getBoundingClientRect(),stripRect=strip?.getBoundingClientRect(),messagesRect=messages?.getBoundingClientRect();return{count:items.length,noHorizontalOverflow:!!card&&card.scrollWidth<=card.clientWidth+1,cardTop:cardRect?.top,cardBottom:cardRect?.bottom,composerTop:composerRect?.top,cardVisible:!!cardRect&&!!composerRect&&cardRect.top>=0&&cardRect.bottom<=composerRect.top,bookingBottom:stripRect?.bottom,messagesTop:messagesRect?.top,messagesDoNotOverlapBooking:!!stripRect&&!!messagesRect&&messagesRect.top>=stripRect.bottom-1,loaded:images.every(image=>image?.complete&&image?.naturalWidth>0),photoWidths:images.map(image=>image?.getBoundingClientRect().width),positions:items.map(item=>{const rect=item.getBoundingClientRect();return{left:rect.left,top:rect.top}})}})()`);
    assert.equal(mobileBookingImageLayout.count,2,`The phone chat keeps a photo for each booked listing: ${JSON.stringify(mobileBookingImageLayout)}`);
    assert(mobileBookingImageLayout.loaded&&mobileBookingImageLayout.noHorizontalOverflow&&mobileBookingImageLayout.cardVisible,`Both compact photo cards fit above the phone composer: ${JSON.stringify(mobileBookingImageLayout)}`);
    assert(mobileBookingImageLayout.messagesDoNotOverlapBooking,`The phone conversation never scrolls under the booking strip: ${JSON.stringify(mobileBookingImageLayout)}`);
    assert(mobileBookingImageLayout.photoWidths.every(width=>width>=44&&width<=52),`Phone photo thumbnails remain real and recognizable: ${JSON.stringify(mobileBookingImageLayout)}`);
    assert(mobileBookingImageLayout.positions[0].left<mobileBookingImageLayout.positions[1].left&&Math.abs(mobileBookingImageLayout.positions[0].top-mobileBookingImageLayout.positions[1].top)<4,`Both listing photos remain side by side on the phone: ${JSON.stringify(mobileBookingImageLayout.positions)}`);
    fs.writeFileSync('/tmp/dbc-customer-rental-images-mobile.png',Buffer.from((await client.cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await client.cmd('Emulation.setDeviceMetricsOverride', {width:1500,height:900,deviceScaleFactor:1,mobile:false}); await wait(80);
    const accountHeader = await client.evaluate(`(()=>{const rail=document.querySelector('[data-testid="admin-account-action-rail"]'),heading=rail?.querySelector('[data-testid="admin-account-management-heading"]');if(!rail||!heading)return null;const bounds=heading.getBoundingClientRect(),railBounds=rail.getBoundingClientRect();return{heading:heading.textContent,duplicateIdentity:!!rail.querySelector('[data-testid="admin-chat-profile-name"]'),headingHeight:bounds.height,headingRight:bounds.right,railRight:railBounds.right,headingScrollWidth:heading.scrollWidth,headingClientWidth:heading.clientWidth}})()`);
    assert(accountHeader && accountHeader.heading === 'Account management' && !accountHeader.duplicateIdentity && accountHeader.headingHeight <= 24 && accountHeader.headingRight <= accountHeader.railRight - 10 && accountHeader.headingScrollWidth <= accountHeader.headingClientWidth, 'The compact tools rail does not repeat the renter identity');
    const workspaceScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-customer-workspace-local-desktop.png", Buffer.from(workspaceScreenshot.data, "base64"));
    for (let attempt = 0; attempt < 50 && !await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[2]?.querySelector('img[alt="Private verification portrait"]')?.naturalWidth > 0`); attempt++) await wait(100);
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[2]?.querySelector('img[alt="Private verification portrait"]')?.naturalWidth > 0`), true, 'A consented private portrait appears in an unselected admin directory row');
    const directoryPortraitScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-private-directory-portraits.png", Buffer.from(directoryPortraitScreenshot.data, "base64"));
    await client.evaluate(`window.__deferStar=true;document.querySelector('[aria-label="Star customer"]').click()`); await wait(50);
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Star customer"]').disabled`),true,'A pending favourite update cannot be submitted twice');
    await client.evaluate(`document.querySelector('[aria-label="Star customer"]').click();document.querySelectorAll('[data-testid="admin-account-row"]')[1].click()`); await wait(50);
    await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[0].click()`); await wait(50);
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Star customer"]').disabled`),true,'Returning to the original customer cannot duplicate a pending update');
    await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[1].click();window.__rejectStar(Error('Delayed failure'))`); await wait(100);
    assert.equal(await client.evaluate(`window.__mutationCalls.filter(call=>call.ref==='accountAdmin.setStarred').length`),1,'Rapid clicks issue one update');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-customer-conversation-pane"]').textContent.includes('Could not confirm the favourite update')`),false,'A delayed failure cannot appear on another customer');
    await client.evaluate(`window.__deferStar=false;window.__failStar=true;document.querySelector('[aria-label="Star customer"]').click()`); await wait(100);
    assert.match(await client.evaluate(`document.querySelector('[data-testid="admin-customer-conversation-pane"] [role="alert"]').textContent`),/Could not confirm the favourite update/,'An update failure is visible in the conversation even when controls are closed');
    const favouriteErrorScreenshot=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-customer-favourite-error.png',Buffer.from(favouriteErrorScreenshot.data,'base64'));
    await client.evaluate(`window.__failStar=false;document.querySelectorAll('[data-testid="admin-account-row"]')[0].click()`); await wait(100);
    assert.match(await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[1].textContent`),/Encore II/,'A verified earned Encore level is shown on the directory row');
    assert.match(await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[3].textContent`),/Encore needs review/,'An incomplete bounded history is explicitly unknown');
    await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[1].click()`); await wait(50);
    assert.match(await client.evaluate('document.querySelector("[data-testid=admin-account-summary]").textContent'),/Earned Encore II/,'The account summary shows the earned Encore level');
    assert.doesNotMatch(await client.evaluate('document.querySelector("[data-testid=admin-account-summary]").textContent'),/Free trial/,'Stripe trial details stay in Billing, not duplicated in the summary');
    await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[2].click()`);
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"][aria-current="true"]').length`), 1, 'Exactly one customer is visibly selected');
    assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('[data-testid="admin-account-row"][aria-current="true"]')).outlineStyle`), 'solid', 'The selected row remains distinguishable from membership glows');
    for (let attempt = 0; attempt < 50 && !await client.evaluate(`document.querySelector('[data-conversation-scope] header img[alt="Private verification portrait"]')?.naturalWidth > 0`); attempt++) await wait(100);
    assert.equal(await client.evaluate(`document.querySelector('[data-conversation-scope] header img[alt="Private verification portrait"]')?.naturalWidth > 0`), true, 'A consented private portrait appears in the admin chat header when no profile photo exists');
    assert.equal(await client.evaluate(`!!document.querySelector('[data-testid="admin-chat-avatar"] [aria-label="Verification current"]')`), true, 'The active 90-day verification badge stays with the single selected-chat portrait');
    const profilePortraitScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-private-portrait-profile.png", Buffer.from(profilePortraitScreenshot.data, "base64"));
    const privatePortraitScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-private-portrait-chat.png", Buffer.from(privatePortraitScreenshot.data, "base64"));
    await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[0].click()`); await wait(50);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-row] [aria-label=" + JSON.stringify("Verification current") + "]").length'), 3, "Only current verification gets a badge");
    assert.equal(await client.evaluate('document.querySelector("a[aria-label=\\"DB Cinema Rentals home\\"]")?.getAttribute("href")'), "/", "The management logo links back to the website");
    assert.equal(await client.evaluate('document.querySelector("header")?.textContent.includes("FORM")'), false, "FORM 7 is absent from the management header");
    await client.evaluate(`document.querySelector('nav[aria-label="Breadcrumb"] button').click()`);
    assert.equal(await client.evaluate('window.__navigation'), 'overview', 'The management breadcrumb opens the dashboard');
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1672, height: 941, deviceScaleFactor: 1, mobile: false }); await wait(100);
    const initialScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-customer-shell-desktop.png", Buffer.from(initialScreenshot.data, "base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false }); await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=admin-customer-conversation-pane]")'), true, "The selected renter has a dedicated conversation pane");
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-row] small svg").length'), 5, 'Each populated customer conversation shows its own preview');
    assert(await client.evaluate(`(()=>[...document.querySelectorAll('[data-testid="admin-account-row"]')].every(row=>{const bounds=row.getBoundingClientRect();return [...row.querySelectorAll('strong,small,small span')].every(child=>{const box=child.getBoundingClientRect();return box.left>=bounds.left-1&&box.right<=bounds.right+1})}))()`), 'Customer names and previews remain within their rows');
    assert.equal(await client.evaluate('document.querySelectorAll("input[type=search]").length'), 1, "Only one customer/chat search is present");
    assert.match(await client.evaluate('document.querySelector("[data-testid=admin-customer-directory]").textContent'), /Can you confirm the camera kit\?/, "Directory rows show a bounded latest-chat preview");
    const desktop = await client.evaluate(`(()=>{const box=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}};return{directory:box(document.querySelector('[data-testid="admin-customer-directory"]')),conversation:box(document.querySelector('[data-testid="admin-customer-conversation-pane"]')),rail:box(document.querySelector('[data-testid="admin-account-action-rail"]')),overflow:document.documentElement.scrollWidth>innerWidth}})()`);
    assert(desktop.directory.right <= desktop.conversation.left + 1 && desktop.conversation.right <= desktop.rail.left + 1, "Desktop columns stay ordered directory → chat → actions");
    assert(desktop.directory.width >= 220 && desktop.conversation.width >= 340 && desktop.rail.width >= 220 && !desktop.overflow, "All three desktop panes remain usable without horizontal overflow");
    assert.equal(await client.evaluate('document.querySelector("[data-conversation-scope]")?.getAttribute("data-conversation-scope")'), "support:account-jordan", "The default thread is account-wide support");
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.trim().startsWith('Rentals')).click()`); await wait(100);
    assert.equal(await client.evaluate(`document.querySelectorAll('[aria-label="Booked equipment"]')[0].children.length`), 2, 'Both booked items appear in the rental history');
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Booked equipment"]')?.querySelectorAll('img.loaded').length`), 2, 'Both booked-item photos load in rental history');
    assert.match(await client.evaluate(`document.querySelectorAll('[aria-label="Booked equipment"]')[0].textContent`), /×2/, 'Repeated units are grouped with their actual quantity');
    const multiItemScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-admin-multi-item-rental.png", Buffer.from(multiItemScreenshot.data, "base64"));
    assert.equal(await client.evaluate(`!![...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Verification needs review'))`),true,'Review is visible even while account support is selected');
    await client.evaluate(`(()=>{const input=document.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Jordan');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait(350); assert.equal(await client.evaluate('window.__lastDirectoryArgs?.search'), "Jordan", "Customer name search reaches the bounded directory query");
    await client.evaluate(`(()=>{const select=document.querySelector('[aria-label="Encore Tier"]');select.value='2';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(100); assert.equal(await client.evaluate('window.__lastDirectoryArgs?.encore'), "2", "Encore assignment filter reaches the server query");
    await client.evaluate(`(()=>{const select=document.querySelector('[aria-label="Encore Tier"]');select.value='all';select.dispatchEvent(new Event('change',{bubbles:true}));})()`); await wait(100);
    assert.equal(await client.evaluate(`!![...document.querySelectorAll('[data-testid="admin-account-row"]')].find(row=>row.textContent.includes('Jordan Blake'))`), true, 'The filtered customer result is ready before opening its rental');
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-row"]')].find(row=>row.textContent.includes('Jordan Blake')).click()`); await wait(100);
    await client.evaluate(`[...document.querySelectorAll('[aria-label="Customer conversations"] button')].find(button=>button.textContent.includes('Verification case')).click()`); await wait(100);
    const verificationActionState = await client.evaluate(`(()=>({profile:document.querySelector('[data-testid="admin-chat-profile-name"]')?.textContent,threads:[...document.querySelectorAll('[aria-label="Customer conversations"] button')].map(button=>button.textContent),actions:[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].map(button=>button.textContent)}))()`);
    assert(verificationActionState.actions.some(text=>text.includes('Verification needs review')), `A Didit manual-review case receives a visible admin action: ${JSON.stringify(verificationActionState)}`);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-account-summary"]')?.textContent.includes('Available credit')`), false, 'The credit balance is not repeated in the summary');
    assert.match(await client.evaluate(`document.querySelector('[data-testid="admin-account-action-rail"]')?.querySelector('button[aria-label="Credits"]')?.textContent ?? document.querySelector('[data-testid="admin-account-action-rail"]')?.textContent ?? ''`), /£12\.00/, 'The credit amount remains visible beside its single Credits action');
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Verification needs review')).click()`); await wait(100);
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Rental verification progress"]')?.textContent.includes('synthetic-session')`), true, 'The paid pending-verification case shows its Didit session');
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Rental verification progress"]')?.textContent.includes('A required check did not pass.')`), true, 'The review panel shows the recorded verification reason');
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Rental verification progress"]')?.textContent.includes('Not recorded')`), true, 'Absent individual provider checks are not presented as passed or missing uploads');
    await client.evaluate(`(()=>{window.__mutationCalls=[];document.querySelector('[aria-label="Refresh Didit decision"]').click()})()`);await wait(100);
    assert.equal(await client.evaluate(`window.__mutationCalls.some(call=>call.ref==='didit.refreshProgress'&&call.args.bookingId==='booking-review'&&call.args.admin===true&&call.args.accountToken==='synthetic-admin')`),true,'The manual refresh checks the selected rental using the admin-scoped provider action');
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Rental verification progress"]')?.textContent.includes('No change yet')`),true,'An unchanged or in-flight refresh does not claim a new provider decision');
    await client.evaluate(`window.__rejectDiditRefresh=true;document.querySelector('[aria-label="Refresh Didit decision"]').click()`);await wait(100);
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Rental verification progress"]')?.textContent.includes('Refresh uncertain')`),true,'An uncertain provider response does not claim the decision was unchanged');
    await client.evaluate(`window.__rejectDiditRefresh=false`);
    await client.evaluate(`[...document.querySelectorAll('[aria-label="Customer conversations"] button')].find(button=>button.textContent.includes('Sony FX3 camera')).click()`); await wait(200);
    assert.equal(await client.evaluate(`!![...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Verification needs review'))`), true, 'A review remains visible when a different rental is selected');
    assert.equal(await client.evaluate('document.querySelector("[data-conversation-scope]")?.getAttribute("data-conversation-scope")'), "rental:booking-camera", "Selecting a rental thread keeps its own booking conversation");
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="rental-items-in-chat"] [data-rental-item-title]').length`), 2, 'The active rental conversation displays every booked item photo');
    assert.equal(await client.evaluate(`document.querySelector('[data-conversation-scope]')?.textContent.includes('2 listings')`), true, 'The booking header counts distinct listings, not physical quantity');
    const rentalImagesScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-customer-rental-images.png", Buffer.from(rentalImagesScreenshot.data, "base64"));
    await wait(120);
    const rentalImageState = await client.evaluate(`Array.from(document.querySelectorAll('[data-testid="rental-items-in-chat"] img')).map(image => ({alt:image.alt,loaded:image.complete && image.naturalWidth > 0,src:image.currentSrc}))`);
    assert.deepEqual(rentalImageState.map(({alt,loaded}) => [alt.includes("camera") ? "camera" : alt.includes("lens") ? "lens" : alt,loaded]), [["camera",true],["lens",true]], "Each booked listing shows its own loaded product image");
    assert.equal(rentalImageState.some(image => image.src.includes("synthetic-avatar.svg")), false, "A renter portrait is never reused as an equipment thumbnail");
    assert.equal(await client.evaluate(`!!document.querySelector('.bookingStrip [data-rental-item-title]')`), false, "The rental header contains no repeated miniature product pictures");
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-account-summary"]')?.querySelectorAll('button').length`), 2, 'Membership and Encore share one access entry point instead of duplicate summary controls');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-account-action-rail"]')?.textContent.includes('Possible identity match')`), true, 'A possible identity match is visible without opening a hidden control');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-account-action-rail"]')?.textContent.includes('This never blocks a rental.')`), true, 'A possible match is a manual review signal and never blocks automatically');
    await client.evaluate(`document.querySelector('[data-testid="admin-account-summary"] button').click()`); await wait(80);
    assert.equal(await client.evaluate(`!!document.querySelector('[aria-label="Account details"] button')?.textContent.includes('Edit')`), true, 'Admins can edit the selected renter contact details from the account overview');
    await client.evaluate(`document.querySelector('[aria-label="Account details"] button').click()`); await wait(50);
    const profileEditDesktop=await client.evaluate(`(()=>{const section=document.querySelector('[aria-label="Account details"]'),form=section?.querySelector('form'),box=form?.getBoundingClientRect(),fields=[...(form?.querySelectorAll('input,textarea,button')??[])].map(field=>{const rect=field.getBoundingClientRect();return{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom}});return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:!!box&&fields.some(rect=>rect.left<box.left-1||rect.right>box.right+1),fields:fields.length}})()`);
    assert.equal(profileEditDesktop.scrollWidth<=profileEditDesktop.width,true,'The account edit card does not create desktop horizontal overflow');
    assert.equal(profileEditDesktop.overflow,false,'Profile fields and actions stay within the management rail');
    const profileEditDesktopImage=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-account-details-edit-desktop.png',Buffer.from(profileEditDesktopImage.data,'base64'));
    await client.evaluate(`(()=>{const form=document.querySelector('[aria-label="Account details"] form');const labels=[...form.querySelectorAll('label')];const set=(prefix,value)=>{const field=labels.find(label=>label.textContent.trim().startsWith(prefix)).querySelector('input,textarea');const proto=field instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));};set('Name','Jordan Blake');set('Phone','+44 7700 900123');set('Address','2 Trafalgar Square');set('Reason','Corrected renter address');})()`); await wait(50);
    await client.evaluate(`document.querySelector('[aria-label="Account details"] form').requestSubmit()`); await wait(100);
    assert.deepEqual(await client.evaluate(`(()=>{const call=window.__mutationCalls.find(item=>item.ref==='accountAdmin.updateProfile');return call?{accountId:call.args.accountId,name:call.args.name,phone:call.args.phone,address:call.args.address,expected:call.args.expected,reason:call.args.reason}:null})()`),{accountId:'account-jordan',name:'Jordan Blake',phone:'+44 7700 900123',address:'2 Trafalgar Square',expected:{name:'Jordan Blake',phone:'+44 7700 900123',address:null},reason:'Corrected renter address'},'The profile form calls the account-bound update mutation with optimistic snapshot and audit reason');
    assert.match(await client.evaluate(`document.querySelector('[data-testid="admin-account-action-rail"]')?.textContent ?? ''`), /Account details saved/, 'The admin receives a clear save result');
    await client.evaluate(`window.__details['account-jordan'].membershipStatus='trialing';window.__details['account-jordan'].trialEnd=Date.UTC(2030,0,8);document.querySelector('[data-testid="admin-membership-summary"]').click()`); await wait(100);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-subscription-summary"]')?.textContent`), 'Trial', 'The collapsed billing row shows the live subscription state without duplicating it in membership');
    assert.match(await client.evaluate(`document.querySelector('[data-testid="admin-account-summary"]').textContent`), /Membership/, 'The access editor has a clear membership label');
    assert.match(await client.evaluate(`document.querySelector('[data-testid="admin-current-access"]').closest('section')?.querySelector('h3')?.textContent ?? ''`), /Membership & Encore/, 'Membership and Encore controls share one titled editor');
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-level]").length'), 1, "Membership controls appear once inside the right rail");
    assert.deepEqual(await client.evaluate(`Array.from(document.querySelector('[data-testid="admin-account-encore-level"]').options).map(option=>option.value)`), ['automatic','1','2','3'], 'All three Encore tiers remain configurable alongside automatic progress');
    const accessSummaryText = await client.evaluate(`document.querySelector('[data-testid="admin-current-access"]').textContent`);
    assert.match(accessSummaryText, /Encore/, `The single access row summarizes the selected account’s effective Encore tier: ${accessSummaryText}`);
    await client.evaluate(`document.querySelector('[data-testid="admin-account-action-rail"]').scrollTop=0`); await wait(50);
    const expandedAccessScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-customer-access-expanded.png", Buffer.from(expandedAccessScreenshot.data, "base64"));
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Billing')).click()`); await wait(100);
    await client.evaluate(`document.querySelector('[data-testid="admin-account-action-rail"]').scrollTop=0`); await wait(50);
    const billingOverviewImage=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-membership-billing-overview.png',Buffer.from(billingOverviewImage.data,'base64'));
    const billingText = await client.evaluate(`document.querySelector('[aria-label="Billing"]')?.textContent ?? ''`);
    assert.match(billingText, /Free trial/, "A trial is never presented as a paid subscription");
    assert.doesNotMatch(billingText, /Credit sync|Refund check|Invoice checks|Refresh status/, "Billing avoids repeating invoice and credit diagnostics");
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="admin-billing-tools"], [aria-label="Subscription credit sync"], [aria-label="Subscription refund reviews"]').length`),0,"Duplicate diagnostic tiles are not rendered");
    assert.equal(await client.evaluate(`document.querySelectorAll('[aria-label="Manage subscription billing in Stripe"]').length`),1,"Billing keeps one direct subscription-management control");
    assert.equal(await client.evaluate(`Array.from(document.querySelectorAll('[data-testid="admin-account-profile-sections"] button')).filter(button=>/membership|encore/i.test(button.textContent)).length`),0,"Membership and Encore do not also appear as duplicate profile-section actions");
    await client.evaluate(`document.querySelector('[aria-label="Billing"]').scrollIntoView({block:'center',behavior:'instant'})`);await wait(50);const billingReceiptImage=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-membership-invoice-check.png',Buffer.from(billingReceiptImage.data,'base64'));
    await client.evaluate(`window.open=()=>({opener:null,location:{replace:url=>window.__billingUrl=url},close:()=>{}});document.querySelector('[aria-label="Manage subscription billing in Stripe"]').click()`); await wait(100);
    assert.equal(await client.evaluate('window.__billingUrl'), 'https://billing.stripe.com/p/session/fixture', 'The selected customer opens the actual billing action');
    assert.equal(await client.evaluate(`window.__mutationCalls.find(call=>call.ref==='checkout.adminBillingPortal')?.args.accountId`), 'account-jordan', 'The billing action targets the selected account');
    await client.cmd('Emulation.setDeviceMetricsOverride',{width:320,height:780,deviceScaleFactor:1,mobile:true});await wait(80);
    assert.equal(await client.evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'The simplified payment panel does not cause phone-width overflow');
    await client.evaluate(`document.querySelector('[aria-label="Billing"]').scrollIntoView({block:'center',behavior:'instant'})`);await wait(50);
    const billingPhoneImage=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-membership-invoice-check-mobile.png',Buffer.from(billingPhoneImage.data,'base64'));
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-mobile-workspace-nav"] button')].find(button=>button.textContent.trim()==='Profile').click()`); await wait(60);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-accounts"]')?.getAttribute('data-mobile-pane')`),'profile','The renter profile is reachable as a dedicated phone view');
    await client.evaluate(`document.querySelector('[data-testid="admin-account-summary"] button').click()`); await wait(50);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-account-action-rail"]')?.textContent.includes('Stripe billing settings opened in a new tab.')`),false,'Billing feedback is cleared when the admin opens a different profile section');
    await client.evaluate(`document.querySelector('[aria-label="Account details"] button').click()`); await wait(50);
    const profileEditMobile=await client.evaluate(`(()=>{const section=document.querySelector('[aria-label="Account details"]'),form=section?.querySelector('form'),box=form?.getBoundingClientRect(),fields=[...(form?.querySelectorAll('input,textarea,button')??[])].map(field=>{const rect=field.getBoundingClientRect();return{left:rect.left,right:rect.right}});return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:!!box&&fields.some(rect=>rect.left<box.left-1||rect.right>box.right+1),fields:fields.length}})()`);
    assert.equal(profileEditMobile.scrollWidth<=profileEditMobile.width,true,'The account edit card does not create mobile horizontal overflow');
    assert.equal(profileEditMobile.overflow,false,'Profile fields and actions stay within the mobile account panel');
    const profileEditMobileImage=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-account-details-edit-mobile.png',Buffer.from(profileEditMobileImage.data,'base64'));
    await client.evaluate(`document.querySelector('[aria-label="Account details"] form button[type="button"]').click()`); await wait(40);
    await client.cmd('Emulation.setDeviceMetricsOverride',{width:1500,height:900,deviceScaleFactor:1,mobile:false});await wait(80);
    await client.evaluate(`window.__details['account-jordan'].membershipStatus='canceled'`);
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Invoices')).click()`); await wait(50);
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Billing')).click()`); await wait(50);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-level]").length'), 0, "The selected action row collapses its controls");
    assert.match(await client.evaluate('document.querySelector("[aria-label=\\"Billing\\"]")?.textContent||""'), /Canceled/, "Canceled subscriptions retain their real billing status");
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-subscription-summary"]')?.textContent`), 'Canceled', 'The collapsed billing control stays in sync with subscription state');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-subscription-summary"]')?.textContent`), 'Canceled', 'The collapsed billing control stays in sync with subscription state');
    await client.evaluate(`document.querySelector('[data-testid="admin-membership-summary"]').click()`); await wait(50);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-level]").length'), 1, "Membership access appears once in the combined access panel");
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-encore-level]").length'), 1, "Encore selection shares the same panel without duplicate summary controls");
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="admin-membership-summary"]').length`), 1, 'Membership and Encore controls have one clear entry point');
    await client.evaluate(`document.querySelector('[data-testid="admin-membership-summary"]').click()`); await wait(50);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-level]").length'), 0, "The membership panel collapses cleanly");
    await client.evaluate(`document.querySelector('[data-testid="admin-membership-summary"]').click()`); await wait(50);
    await client.evaluate(`document.querySelector('[data-testid="admin-account-encore-level"]').focus()`);
    assert.equal(await client.evaluate(`document.activeElement?.getAttribute('data-testid')`), 'admin-account-encore-level', 'The Encore level remains directly editable in its expanded panel');
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-level"]').length`), 1, 'Access panel controls do not duplicate');
    await wait(500);
    assert.equal(await client.evaluate(`(()=>{const rail=document.querySelector('[data-testid="admin-account-action-rail"]').getBoundingClientRect(),close=document.querySelector('[aria-label="Close rental access controls"]').getBoundingClientRect();return close.top>=rail.top&&close.bottom<=rail.bottom})()`), true, 'Close remains visible while the controls scroll');
    await client.evaluate(`document.querySelector('[aria-label="Close rental access controls"]').click()`); await wait(50);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-level]").length'), 0, 'The expanded controls can be closed without scrolling back to the summary');
    await client.evaluate(`document.querySelector('[data-testid="admin-membership-summary"]').click()`); await wait(50);
    await client.evaluate(`(()=>{const input=document.querySelector('[data-testid="admin-account-reason"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Fixture check');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait(50);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-save-level]").length'), 1, "Existing permission-checked membership mutation remains a single control");
    await client.evaluate(`(()=>{const select=document.querySelector('[data-testid="admin-account-level"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'pro');select.dispatchEvent(new Event('change',{bubbles:true}));})()`); await wait(50);
    await client.evaluate(`document.querySelector('[data-testid="admin-account-save-level"]').click()`); await wait(80);
    assert.deepEqual(await client.evaluate(`(()=>{const call=window.__mutationCalls.find(item=>item.ref==='accountAdmin.setLevel');return call?{accountId:call.args.accountId,level:call.args.level,reason:call.args.reason}:null})()`),{accountId:'account-jordan',level:'pro',reason:'Fixture check'},'The membership selector applies the chosen real account-access mutation with an audit reason');
    await client.evaluate(`(()=>{const select=document.querySelector('[data-testid="admin-account-encore-level"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'2');select.dispatchEvent(new Event('change',{bubbles:true}));})()`); await wait(50);
    await client.evaluate(`document.querySelector('[data-testid="admin-account-save-encore-level"]').click()`); await wait(80);
    assert.deepEqual(await client.evaluate(`(()=>{const call=window.__mutationCalls.find(item=>item.ref==='accountAdmin.setEncoreLevel');return call?{accountId:call.args.accountId,level:call.args.level,expectedLevel:call.args.expectedLevel,reason:call.args.reason}:null})()`),{accountId:'account-jordan',level:2,expectedLevel:3,reason:'Fixture check'},'The Encore selector writes its selected tier through the permission-checked mutation');
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Rental actions')).click()`); await wait(50);
    await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=owner-rental-tools]")'), true, `Selected rental actions open in the account rail: ${JSON.stringify(await client.evaluate('window.__errors'))}`);
    await client.evaluate(`[...document.querySelectorAll('[data-testid="owner-rental-tools"] button')].find(button=>button.textContent.includes('Partial / full rental refund')).click()`); await wait(50);
    await client.evaluate(`(()=>{const form=document.querySelector('[data-testid="owner-rental-tools"] form');for(const [selector,value] of [['input[type=number]','15'],['textarea','Fixture refund reason']]){const input=form.querySelector(selector);Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}})()`); await wait(50);
    await client.evaluate(`document.querySelector('[data-testid="owner-rental-tools"] form').requestSubmit()`); await wait(100);
    assert.deepEqual(await client.evaluate(`(()=>{const call=window.__mutationCalls.find(item=>item.ref==='checkout.refundRental');return call?{bookingId:call.args.bookingId,amountPence:call.args.amountPence,reason:call.args.reason}:null})()`), {bookingId:'booking-camera',amountPence:1500,reason:'Fixture refund reason'}, 'Refund controls target the selected rental with the confirmed amount and reason');
    await client.evaluate(`window.__accounts[0].blocked=true;window.__accounts[0].blockedAt=123;window.__accounts[0].restrictionNoticeId='notice-fixture';window.__details['account-jordan'].restrictionNotice={state:'attention',sentAt:null};[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Restrict account')).click()`); await wait(100);
    assert.match(await client.evaluate('document.querySelector("[data-testid=admin-account-action-rail]").textContent'), /Notice needs attention/, 'A failed or uncertain restriction notice is visible to the administrator');
    await client.evaluate(`window.__accounts[0].blocked=false;window.__accounts[0].blockedAt=null;window.__accounts[0].restrictionNoticeId=null;[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Unblock account')).click()`); await wait(50);
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Restrict account')).click()`); await wait(50);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-account-reason"]').value`),'','A reason from a different control is not reused for a restriction');
    await client.evaluate(`(()=>{const input=document.querySelector('[data-testid="admin-account-reason"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Fixture restriction');input.dispatchEvent(new Event('input',{bubbles:true}));})()`); await wait(50);
    await client.evaluate(`document.querySelector('[data-testid="admin-account-block"]').click()`); await wait(50);
    assert.match(await client.evaluate(`document.querySelector('[aria-label="Confirm account change"]').textContent`),/Restrict Jordan Blake\?.*Reason: Fixture restriction/,'Review shows the selected customer and exact reason');
    await client.evaluate(`(()=>{const input=document.querySelector('[data-testid="admin-account-reason"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Revised fixture reason');input.dispatchEvent(new Event('input',{bubbles:true}));})()`); await wait(50);
    assert.equal(await client.evaluate(`!!document.querySelector('[data-testid="admin-account-confirm-block"]')`),false,'Changing the reason invalidates the earlier confirmation');
    await client.evaluate(`window.__mutationCalls=[];document.querySelector('[data-testid="admin-account-block"]').click()`); await wait(50);
    await client.evaluate(`document.querySelector('[data-testid="admin-account-confirm-block"]').click()`); await wait(50);
    assert.deepEqual(await client.evaluate(`(()=>{const call=window.__mutationCalls.find(item=>item.ref==='accountAdmin.setBlocked');return call?{accountId:call.args.accountId,blocked:call.args.blocked,reason:call.args.reason}:null})()`),{accountId:'account-jordan',blocked:true,reason:'Revised fixture reason'},'Only the reviewed account and revised reason are submitted');
    await client.evaluate(`window.__accounts[0].blocked=true;window.__accounts[0].blockedAt=456;window.__accounts[0].restrictionNoticeId='notice-new';[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Restrict account')).click()`); await wait(50);
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Unblock account')).click()`); await wait(50);
    await client.evaluate(`(()=>{const input=document.querySelector('[data-testid="admin-account-reason"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Fixture unblock');input.dispatchEvent(new Event('input',{bubbles:true}));})()`); await wait(50);
    await client.evaluate(`window.__mutationCalls=[];document.querySelector('[data-testid="admin-account-block"]').click()`); await wait(50);
    assert.equal(await client.evaluate(`window.__mutationCalls.some(item=>item.ref==='accountAdmin.setBlocked')`),false,'Reviewing an unblock does not immediately change the account');
    assert.match(await client.evaluate(`document.querySelector('[aria-label="Confirm account change"]').textContent`),/Restore access for Jordan Blake\?.*Reason: Fixture unblock/,'Unblocking has an explicit review with the customer and reason');
    await client.evaluate(`document.querySelector('[data-testid="admin-account-confirm-block"]').click()`); await wait(50);
    assert.equal(await client.evaluate(`window.__mutationCalls.find(item=>item.ref==='accountAdmin.setBlocked')?.args.blocked`),false,'Confirming the review requests an unblock');
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Open in full inbox')).click()`);
    assert.deepEqual(await client.evaluate('window.__openedFullInbox'), { accountId: "account-jordan", bookingId: "booking-camera" }, "The existing full-inbox navigation retains selected account and rental IDs");
    for (const width of [320, 390, 1280, 1500]) {
      await client.cmd("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 }); await wait(100);
      const state = await client.evaluate(`(()=>({overflow:document.documentElement.scrollWidth>innerWidth,panes:[...document.querySelectorAll('[data-testid="admin-customer-conversation-pane"],[data-testid="admin-account-action-rail"]')].map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}})}))()`);
      assert(!state.overflow, `No horizontal overflow at ${width}px`);
      if (width === 320) {
        assert.equal(await client.evaluate(`(()=>{const header=document.querySelector('header');return [...header.querySelectorAll('a,button')].every(item=>{const rect=item.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth})})()`), true, 'Header controls stay within the narrow viewport');
        await client.evaluate(`document.querySelector('button[aria-label="Toggle account menu"]').click()`);
        assert.equal(await client.evaluate(`document.querySelector('button[aria-label="Toggle account menu"]').getAttribute('aria-expanded')`), 'true', 'The mobile account menu opens');
        await client.evaluate(`document.querySelector('button[aria-label="Close account menu"]').click()`);
      }
      if (width >= 1500) assert(state.panes[0].right <= state.panes[1].left + 1, "Wide layout keeps the conversation before the action rail");
      if (width === 1500) {
        const chatWidth = await client.evaluate(`document.querySelector('[data-testid="admin-customer-conversation-pane"]').getBoundingClientRect().width`);
        assert(chatWidth >= 460, `Wide account workspace preserves a roomy chat pane: ${chatWidth}px`);
      }
      assert.equal(await client.evaluate(`(()=>{const chat=document.querySelector('[data-testid="admin-customer-conversation-pane"]'),heading=chat?.querySelector('[data-testid="admin-chat-profile-name"]'),call=chat?.querySelector('header a[href^="tel:"]'),rail=document.querySelector('[data-testid="admin-account-action-rail"]'),railHeading=rail?.querySelector('[data-testid="admin-account-management-heading"]'),close=rail?.querySelector('[aria-label="Close customer profile"]');if(!chat||!heading||!call||!railHeading||!close)return false;const a=heading.getBoundingClientRect(),b=call.getBoundingClientRect(),c=railHeading.getBoundingClientRect(),d=close.getBoundingClientRect();return(a.right<=b.left||a.bottom<=b.top||a.top>=b.bottom)&&c.right<=d.left&&rail.querySelector('[data-testid="admin-profile-avatar"]')===null})()`),true,`The unique renter contact and compact tools title stay separated at ${width}px`);
      assert.equal(await client.evaluate(`(()=>{const button=document.querySelector('[data-testid="admin-account-action-rail"] button[aria-controls]');return !!document.getElementById(button?.getAttribute('aria-controls'))})()`),true,'Expandable actions reference their content');
      if (width === 390) {
        const screenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-customer-workspace-mobile.png", Buffer.from(screenshot.data, "base64"));
        await client.cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
        await client.evaluate(`window.scrollTo(0,0);window.__scrollOptions=null;const original=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(options){if(this.matches('[data-testid="admin-customer-conversation-pane"]'))window.__scrollOptions=options;return original.call(this,options)};document.querySelector('[data-testid="admin-account-row"]').click()`);
        await wait(250);
        assert.equal(await client.evaluate(`window.__scrollOptions?.behavior`), "auto", "Opening a mobile customer respects reduced motion");
        const visible = await client.evaluate(`(()=>{const paneElement=document.querySelector('[data-testid="admin-customer-conversation-pane"]'),pane=paneElement.getBoundingClientRect(),header=document.querySelector('header').getBoundingClientRect(),root=document.querySelector('[data-testid="admin-accounts"]'),nav=document.querySelector('[data-testid="admin-mobile-workspace-nav"]'),tools=root?.querySelector('[data-testid="admin-page-tools"]');return {paneTop:pane.top,headerBottom:header.bottom,scrollY,scrollMargin:getComputedStyle(paneElement).scrollMarginTop,mobilePane:root?.dataset.mobilePane,navDisplay:nav&&getComputedStyle(nav).display,rootTop:root?.getBoundingClientRect().top,pageToolsDisplay:tools&&getComputedStyle(tools).display}})()`);
        assert(visible.paneTop >= visible.headerBottom - 1 && visible.paneTop < visible.headerBottom + 35, `Mobile customer navigation leaves the chat header visible below the site header: ${JSON.stringify(visible)}`);
        assert(await client.evaluate(`document.querySelector('[data-testid="admin-customer-conversation-pane"]').getBoundingClientRect().bottom >= innerHeight - 30`), "An opened mobile admin conversation uses the available screen height");
        assert(await client.evaluate(`(()=>{const box=document.querySelector('[data-testid="admin-customer-conversation-pane"] textarea').getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight})()`), "The mobile admin composer remains visible when the conversation opens");
        const openedChatScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-customer-opened-chat-mobile.png", Buffer.from(openedChatScreenshot.data, "base64"));
        await client.cmd("Emulation.setEmulatedMedia", { features: [] });
        await client.evaluate("window.scrollTo(0,0)");
      }
    }
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?renter=1&extension=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-testid=gaffer-extension-card]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=gaffer-extension-card]")'), true, `Gaffer presents the image-rich extension action in the renter chat: ${await client.evaluate('JSON.stringify({errors:window.__errors,targets:window.__rentalTargets,text:document.body.textContent.slice(-1200)})')}`);
    assert.equal(await client.evaluate('document.querySelector("[data-testid=gaffer-extension-card]").textContent.includes("Original return 4 Jan 2030")'), true, 'The Gaffer card formats the original due date for renters');
    assert.equal(await client.evaluate(`window.__extensionImageSources?.[0] === ${JSON.stringify(cameraListingPhoto)}`), true, `The renter message fixture carries the original FX3 listing image: ${await client.evaluate('JSON.stringify({sources:window.__extensionImageSources,errors:window.__errors,targets:window.__rentalTargets})')}`);
    for (let attempt = 0; attempt < 50 && !await client.evaluate('document.querySelector("[data-testid=gaffer-extension-card] img")?.naturalWidth > 0'); attempt++) await wait(100);
    assert.equal(await client.evaluate('document.querySelector("[data-testid=gaffer-extension-card] img")?.naturalWidth > 0'), true, `The Gaffer extension card loads the listing image: ${await client.evaluate('JSON.stringify({images:[...document.querySelectorAll("[data-testid=gaffer-extension-card] img")].map(image=>({src:image.src,alt:image.alt,complete:image.complete,width:image.naturalWidth})),card:document.querySelector("[data-testid=gaffer-extension-card]")?.innerHTML.slice(0,900)})')}`);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=rental-items-in-chat] [data-rental-item-title]").length'),2,"The renter chat shows a separate photo tile for each booked listing");
    assert.deepEqual(await client.evaluate('Array.from(document.querySelectorAll("[data-testid=rental-items-in-chat] img")).map(image=>image.getAttribute("src"))'),[cameraListingPhoto,lensListingPhoto],"The renter receives each exact rented listing photo rather than a camera or lens drawing");
    for (let attempt = 0; attempt < 50 && !await client.evaluate('Array.from(document.querySelectorAll("[data-testid=rental-items-in-chat] img")).every(image=>image.complete&&image.naturalWidth>0)'); attempt++) await wait(100);
    assert.equal(await client.evaluate('Array.from(document.querySelectorAll("[data-testid=rental-items-in-chat] img")).every(image=>image.complete&&image.naturalWidth>0)'),true,"Every renter rental-photo tile loads its real listing image");
    const renterRentalScreenshot=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync("/tmp/dbc-renter-rental-thread-photos.png",Buffer.from(renterRentalScreenshot.data,"base64"));
    await client.evaluate('Array.from(document.querySelectorAll("[data-testid=renter-rental-tools] button")).find(button=>button.textContent.trim()==="Reschedule")?.click()');
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-testid=renter-reschedule-items]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=renter-reschedule-items]")'),true,`The reschedule request identifies the exact items that will move: ${await client.evaluate('JSON.stringify({tools:!!document.querySelector("[data-testid=renter-rental-tools]"),buttons:[...document.querySelectorAll("button")].map(button=>button.textContent.trim()).filter(Boolean),errors:window.__errors,targets:window.__rentalTargets})')}`);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=renter-reschedule-items] article img").length'),2,"Every item in a multi-listing reschedule has its own real listing image");
    assert.deepEqual(await client.evaluate('Array.from(document.querySelectorAll("[data-testid=renter-reschedule-items] img")).map(image=>image.getAttribute("src"))'),[cameraListingPhoto,lensListingPhoto],"Reschedule uses the photo for each actual listing, not camera/lens drawings");
    for (let attempt = 0; attempt < 50 && !await client.evaluate('Array.from(document.querySelectorAll("[data-testid=renter-reschedule-items] img")).every(image=>image.complete&&image.naturalWidth>0)'); attempt++) await wait(100);
    assert.equal(await client.evaluate('Array.from(document.querySelectorAll("[data-testid=renter-reschedule-items] img")).every(image=>image.complete&&image.naturalWidth>0)'),true,"Every actual rental photo loads in the reschedule control");
    const rescheduleImages = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-renter-reschedule-photos.png", Buffer.from(rescheduleImages.data, "base64"));
    await client.evaluate(`(()=>{const set=(element,value)=>{const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element),'value').set;setter.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}))};set(document.querySelector('[aria-label="New collection date"]'),'2030-01-05');set(document.querySelector('[aria-label="Reschedule reason"]'),'The shoot moved by one day')})()`);
    for (let attempt = 0; attempt < 100 && await client.evaluate('document.querySelector("[data-testid=renter-rental-tools] form button:not([type=button])")?.disabled !== false'); attempt++) await wait(100);
    const rescheduleState = await client.evaluate(`(()=>{const form=document.querySelector('[data-testid="renter-rental-tools"] form'),date=form?.querySelector('[aria-label="New collection date"]'),reason=form?.querySelector('[aria-label="Reschedule reason"]'),button=form?.querySelector('button:not([type="button"])');return{date:date?.value,reason:reason?.value,enabled:button?!button.disabled:null,text:form?.textContent,errors:window.__errors}})()`);
    assert.equal(rescheduleState.enabled,true,`Rescheduling waits for live availability before allowing the request: ${JSON.stringify(rescheduleState)}`);
    await client.evaluate('document.querySelector("[data-testid=renter-rental-tools] form button:not([type=button])").click()');
    for (let attempt = 0; attempt < 100 && !await client.evaluate('window.__mutationCalls.some(call=>call.ref==="rentalRequests.submit"&&call.args.kind==="dates")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('window.__mutationCalls.some(call=>call.ref==="rentalRequests.submit"&&call.args.kind==="dates")'),true,"Renter rescheduling creates a review request rather than changing rental dates directly");
    assert.equal(await client.evaluate('window.__mutationCalls.some(call=>call.ref==="rentalOperations.reschedule")'),false,"A renter cannot apply their own date change");
    assert.match(await client.evaluate('document.querySelector("[data-testid=renter-rental-tools]")?.textContent??""'),/Request sent for team approval/,"The renter is told the team must approve before the booking changes");
    await client.evaluate('Array.from(document.querySelectorAll("[data-testid=renter-rental-tools] button")).find(button=>button.textContent.includes("refund options"))?.click()');
    assert.equal(await client.evaluate('document.querySelector("[data-testid=renter-rental-tools] fieldset")?.textContent.includes("Full refund to original payment method")&&document.querySelector("[data-testid=renter-rental-tools] fieldset")?.textContent.includes("100% account credit")'),true,"The renter can see both accepted settlement choices when eligible");
    await client.evaluate('document.querySelector("[data-testid=renter-rental-tools] form button[type=button]")?.click()');
    const renterColumns = await client.evaluate('(()=>{const pane=document.querySelector("[data-conversation-scope]"),style=getComputedStyle(pane);return{width:pane.getBoundingClientRect().width,display:style.display,hasDuplicateRail:!!pane.querySelector("aside")}})()');
    assert(renterColumns.width > 1000 && !renterColumns.hasDuplicateRail, `The renter conversation uses the full-width chat instead of a cramped duplicate rail: ${JSON.stringify(renterColumns)}`);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=request-extension-open]")'), false, "The separate extension trigger is hidden when the Gaffer chat card already offers the same action");
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=gaffer-extension-open], [data-testid=request-extension-open]").length'), 1, "Only one extension entry point is shown");
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=extension-review], [data-testid=extension-withdraw], [data-testid=extension-approve]")'), false, 'Renter chat never exposes admin approval or withdrawal controls');
    const renterExtensionOffer = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-renter-extension-offer.png", Buffer.from(renterExtensionOffer.data, "base64"));
    await client.evaluate('document.querySelector("[data-testid=gaffer-extension-open]").click()');
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-testid=extension-live-quote]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=extension-live-quote]")'), true, 'Opening the card reveals the live, itemised extension quote');
    for (let attempt = 0; attempt < 50 && !await client.evaluate('document.querySelector("[data-testid=extension-live-quote] img")?.naturalWidth > 0'); attempt++) await wait(100);
    assert.equal(await client.evaluate('document.querySelector("[data-testid=extension-live-quote] img")?.naturalWidth > 0'), true, `The live extension quote loads the listing image: ${await client.evaluate('JSON.stringify([...document.querySelectorAll("[data-testid=extension-live-quote] img")].map(image=>({src:image.src,alt:image.alt,complete:image.complete,width:image.naturalWidth})))')}`);
    assert.equal(await client.evaluate('document.querySelector("[data-testid=extension-live-quote]").textContent.includes("Available items only")'), true, 'Partial availability is clearly labelled');
    assert.equal(await client.evaluate('document.querySelector("[data-testid=extension-live-quote]").textContent.includes("Return by 4 Jan 2030 at 17:00")'), true, 'Unavailable items retain their original return deadline');
    assert.equal(await client.evaluate('document.querySelector("[data-testid=extension-live-quote]").textContent.includes("Sony FX6 camera")'), true, 'A date-checked alternative is shown inline');
    assert.equal(await client.evaluate('(()=>{const input=document.querySelectorAll("[data-testid=extension-request-form] input[type=checkbox]")[1];return input?.disabled===true&&input.checked===false})()'), true, 'Unavailable items cannot be selected for an extension');
    await client.evaluate('document.querySelector("[data-testid=extension-live-quote] button").click()'); await wait(50);
    assert.match(await client.evaluate('document.querySelector("[data-conversation-scope] textarea")?.value??""'), /Sony FX6 camera/, 'Asking about an alternative prefills a renter message');
    assert.equal(await client.evaluate('window.__mutationCalls.some(call=>call.ref==="rentalChat.send")'), false, 'Alternative questions require the renter to send them');
    const renterExtensionImage = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-renter-extension-flow.png", Buffer.from(renterExtensionImage.data, "base64"));
    await client.evaluate(`document.querySelector("[data-testid=extension-request-form] select[data-testid=extension-return-time]").value="17:00";document.querySelector("[data-testid=extension-request-form] select[data-testid=extension-return-time]").dispatchEvent(new Event("change",{bubbles:true}))`); await wait(50);
    await client.evaluate('document.querySelector("[data-testid=extension-send-request]").click()');
    for (let attempt = 0; attempt < 100 && !await client.evaluate('window.__mutationCalls.some(call=>call.ref==="rentalExtensions.request")'); attempt++) await wait(100);
    assert.deepEqual(await client.evaluate('window.__mutationCalls.find(call=>call.ref==="rentalExtensions.request")?.args.lineItemIndexes'), [0], 'The renter request includes only the live-available item');
    assert.equal(await client.evaluate('document.body.textContent.includes("Your original return dates remain in place")'), true, 'The chat confirms dates stay unchanged until approval and payment');
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?visual=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-testid=admin-account-row]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]').length`), 5, 'The reference-size desktop comparison shows five synthetic customer tiers');
    await client.evaluate(`document.querySelector('[data-testid="admin-account-row"]').click()`); await wait(250);
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="admin-rental-thread-photo"]').length`), 0, 'Conversation tabs do not use tiny product pictures as icons');
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1672, height: 940, deviceScaleFactor: 1, mobile: false }); await wait(150);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-customer-conversation-pane"]').getBoundingClientRect().width >= 500`), true, 'The reference-size desktop comparison keeps a roomy chat pane');
    const screenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-customer-workspace-desktop.png", Buffer.from(screenshot.data, "base64"));
    await client.evaluate(`[...document.querySelectorAll('[aria-label="Customer conversations"] button')].find(button=>button.textContent.includes('Sony FX3 camera')).click()`); await wait(200);
    assert.deepEqual(await client.evaluate(`Array.from(document.querySelectorAll('[data-testid="rental-items-in-chat"] img')).map(image => image.getAttribute('src'))`), [cameraListingPhoto, lensListingPhoto], 'The selected multi-item rental chat displays the real photo for each exact rented listing');
    const rentalScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-customer-rental-thread-photos.png", Buffer.from(rentalScreenshot.data, "base64"));
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?renter=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-conversation-scope]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('document.querySelector("[data-conversation-scope]")?.getAttribute("data-role")'), 'renter', 'The customer conversation retains its renter role');
    assert.equal(await client.evaluate('!!document.querySelector("aside button")'), true, 'The real renter conversation directory renders');
    assert.equal(await client.evaluate(`document.querySelector('aside button[aria-current="true"]')?.textContent.includes('Account support')`), true, 'The default support conversation is visibly selected');
    assert.equal(await client.evaluate(`document.body.textContent.includes('Sony FX3 camera') && document.body.textContent.includes('Sony 24–70mm lens')`), true, 'The customer directory renders multiple synthetic rental conversations');
    assert.equal(await client.evaluate(`document.querySelectorAll('[aria-label="Photo unavailable"]').length`), 0, 'The renter extension flow uses the available listing photos instead of symbol placeholders');
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Your conversations"] [aria-label="2 unread messages"]')?.textContent`), '2', 'Unread rental counts are labelled for assistive technology');
    for (const width of [320, 390, 768, 1023, 1100, 1500]) {
      await client.cmd("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 }); await wait(100);
      assert.equal(await client.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, `The renter workspace does not overflow at ${width}px`);
      assert.equal(await client.evaluate(`!![...document.querySelectorAll('button')].find(item=>item.textContent.includes('Request a human'))`), false, `No permanent human-request button appears at ${width}px`);
      if (width >= 768 && width <= 1023) {
        const cardWidth = await client.evaluate(`document.querySelector('[aria-label="Your conversations"] button').getBoundingClientRect().width`);
        assert(cardWidth >= 210 && cardWidth <= 230, `Tablet conversation cards remain compact at ${width}px: ${cardWidth}`);
        assert(await client.evaluate(`document.querySelector('[data-conversation-scope]').getBoundingClientRect().bottom >= innerHeight - 35`), `The customer chat uses the available tablet height at ${width}px`);
        assert(await client.evaluate(`document.querySelector('[data-conversation-scope] textarea').getBoundingClientRect().bottom <= innerHeight`), `The tablet composer stays visible at ${width}px`);
        if (width === 768) { const image = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-renter-conversation-tablet.png", Buffer.from(image.data, "base64")); }
      }
      if (width === 390) { assert(await client.evaluate(`document.querySelector('[data-conversation-scope]').getBoundingClientRect().bottom >= innerHeight - 30`), 'The customer chat uses the available mobile height'); const image = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-renter-conversation-mobile.png", Buffer.from(image.data, "base64")); }
      if (width === 1500) { const bounds = await client.evaluate(`(()=>{const chat=document.querySelector('[data-conversation-scope]'),parent=chat.parentElement;return {top:chat.getBoundingClientRect().top,bottom:chat.getBoundingClientRect().bottom,parentBottom:parent.getBoundingClientRect().bottom,viewport:innerHeight,border:getComputedStyle(chat).borderTopWidth}})()`); assert(bounds.bottom >= bounds.viewport - 30, `The renter chat uses the available height: ${JSON.stringify(bounds)}`); assert.equal(bounds.border,'1px','The customer chat has a framed workspace like the admin conversation'); }
    }
    await client.evaluate(`document.querySelector('[data-conversation-scope]') && [...document.querySelectorAll('aside button')].find(button=>button.textContent.includes('Sony FX3 camera')).click()`);
    await wait(150);
    assert.equal(await client.evaluate(`document.querySelector('[data-conversation-scope]')?.getAttribute('data-conversation-scope')`), 'rental:renter-camera', 'Selecting a rental opens that rental conversation');
    assert.equal(await client.evaluate(`!!document.querySelector('[aria-label="Rental management controls"], [aria-label="Conversation actions"], [aria-label="Star customer"]')`), false, 'The selected rental does not expose admin controls');
    assert.equal(await client.evaluate(`!!document.querySelector('[data-testid="renter-chat-controls"]')`), true, 'The selected rental retains its renter-side actions');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="renter-handover-details"] a[href^="tel:"]')?.getAttribute('href')`), 'tel:+447933019849', 'The verified, paid, confirmed booking shows Leo’s call action');
    assert(await client.evaluate(`document.querySelector('[data-conversation-scope]').getBoundingClientRect().bottom >= innerHeight - 30`), 'The selected rental chat also fills the available desktop height');
    const renterScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-renter-conversation-desktop.png", Buffer.from(renterScreenshot.data, "base64"));
    for (const width of [320, 390, 1100, 1500]) {
      await client.cmd("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 }); await wait(100);
      assert.equal(await client.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, `The selected rental has no horizontal overflow at ${width}px`);
      assert.equal(await client.evaluate(`(()=>{const input=document.querySelector('[data-conversation-scope] textarea');const rect=input.getBoundingClientRect();return rect.width>150&&rect.left>=0&&rect.right<=innerWidth})()`), true, `The selected rental composer remains usable at ${width}px`);
      if (width === 390) { const mobileRentalScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-renter-rental-mobile.png", Buffer.from(mobileRentalScreenshot.data, "base64")); }
    }
    await client.evaluate(`([...document.querySelectorAll('[data-testid="renter-chat-controls"] button')].find(button=>button.textContent.includes('Cancel · refund options'))).click()`); await wait(50);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="renter-chat-controls"]')?.textContent.includes('More than 7 days before pickup: full refund or 100% account credit')`), true, 'The current signed cancellation terms show the correct full-refund window');
    assert.equal(await client.evaluate(`!![...document.querySelectorAll('[data-testid="renter-chat-controls"] label')].find(label=>label.textContent.includes('100% account credit'))`), true, 'The renter can choose only the settlement options in the accepted terms');
    const cancellationOptionsScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-renter-cancellation-options.png", Buffer.from(cancellationOptionsScreenshot.data, "base64"));
    await client.evaluate(`([...document.querySelectorAll('[data-testid="renter-chat-controls"] label')].find(label=>label.textContent.includes('100% account credit')).querySelector('input').click())`);
    await client.evaluate(`(()=>{const field=document.querySelector('[aria-label="Cancellation request details"]'),setValue=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setValue.call(field,'My plans have changed');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await client.evaluate(`([...document.querySelectorAll('[data-testid="renter-chat-controls"] button')].find(button=>button.textContent.includes('Request cancellation')).click())`);
    for (let attempt = 0; attempt < 50 && !await client.evaluate(`window.__mutationCalls.some(call=>call.ref==='rentalRequests.submit'&&call.args.kind==='cancel')`); attempt++) await wait(50);
    const cancellationRequest = await client.evaluate(`window.__mutationCalls.find(call=>call.ref==='rentalRequests.submit'&&call.args.kind==='cancel')?.args`);
    assert.equal(cancellationRequest?.detail, 'My plans have changed', 'The request stores the renter reason separately from the settlement choice');
    assert.equal(cancellationRequest?.cancellationChoice, 'credit', 'The selected account-credit option is saved explicitly for admin settlement');
    assert.equal(await client.evaluate(`window.__mutationCalls.some(call=>call.ref==='checkout.cancelByCustomer')`), false, 'A confirmed renter cancellation never calls the direct-cancel endpoint');
    assert.match(await client.evaluate(`document.querySelector('[data-testid="renter-chat-controls"]').textContent`), /team approval/i, 'The renter sees that their request is pending team approval');
    assert.equal(await client.evaluate(`document.querySelector('[data-conversation-scope] header img[alt="DB Cinema team"]')?.getAttribute('src')`), '/db-cinema-aperture-blue.png', 'The customer-facing team avatar uses the team image, not the renter identity');
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: true }); await wait(100);
    await client.evaluate(`window.__attachmentRequests=[];window.fetch=async(url)=>{window.__attachmentRequests.push(new URL(url).searchParams.get('key'));return {ok:false,status:503}}`);
    assert.equal(await client.evaluate(`document.querySelector('[data-conversation-scope] input[type=file]').accept`), 'image/jpeg,image/png,image/webp', 'The picker exposes only supported images');
    await client.evaluate(`(()=>{const input=document.querySelector('[data-conversation-scope] input[type=file]'),files=new DataTransfer();files.items.add(new File(['%PDF-'],'fixture.pdf',{type:'application/pdf'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await wait(100);
    assert.match(await client.evaluate(`document.querySelector('[role=alert]').textContent`), /JPG, PNG or WebP image up to 10 MB/);
    assert.equal(await client.evaluate('window.__attachmentRequests.length'), 0, 'A PDF is rejected before any upload');
    const chooseAttachment = async content => { await client.evaluate(`(()=>{const input=document.querySelector('[data-conversation-scope] input[type=file]'),files=new DataTransfer();files.items.add(new File([${JSON.stringify(content)}],'same.png',{type:'image/png',lastModified:123}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`); for(let attempt=0;attempt<50 && await client.evaluate(`document.querySelector('[aria-label="Attach an image, JPG, PNG or WebP up to 10 MB"]')?.disabled`);attempt++)await wait(50); await wait(100); };
    await chooseAttachment('first'); await chooseAttachment('other'); await chooseAttachment('first');
    const keys = await client.evaluate('window.__attachmentRequests');
    assert.equal(keys.length,3,'Each synthetic upload reaches the simulated transport');
    assert.notEqual(keys[0],keys[1],'Different file bytes do not reuse a pending retry key even with identical metadata');
    assert.equal(keys[0],keys[2],'Retrying identical bytes retains the original request key');
    await client.evaluate(`window.__cleanedUpload=null;window.__cleanCalls=0;window.fetch=async(url,options)=>{window.__cleanCalls++;if(window.__cleanCalls===1)return {ok:false,status:403};window.__cleanedUpload=options.body;return {ok:true,status:200}}`);
    await client.evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const context=canvas.getContext('2d');context.fillStyle='#cd3456';context.fillRect(0,0,2,2);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const input=document.querySelector('[data-conversation-scope] input[type=file]'),files=new DataTransfer();files.items.add(new File([blob,'metadata-to-remove'],'photo.png',{type:'image/png'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    for(let attempt=0;attempt<50&&!await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy')`);attempt++)await wait(50);
    assert.match(await client.evaluate('document.querySelector("[data-conversation-scope]").textContent'),/original stays on your device/i,'The opt-in explains that the original is not replaced');
    assert.equal(await client.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent==='Send cleaned PNG copy'),rect=button.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight})()`),true,'The cleaned-copy choice is visible on the mobile viewport');
    const mobileComposerBounds = await client.evaluate(`(()=>{const input=document.querySelector('[data-conversation-scope] textarea'),rect=input.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,innerHeight,visualHeight:visualViewport?.height,scrollY,documentHeight:document.documentElement.scrollHeight}})()`);
    assert(mobileComposerBounds.top >= 0 && mobileComposerBounds.bottom <= mobileComposerBounds.innerHeight, `The mobile composer remains visible with the cleaned-copy option: ${JSON.stringify(mobileComposerBounds)}`);
    const cleanOptionScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-chat-clean-copy-mobile.png", Buffer.from(cleanOptionScreenshot.data, "base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false }); await wait(100);
    const desktopComposerBounds = await client.evaluate(`(()=>{const nodes=[...document.querySelectorAll('button')].filter(item=>item.textContent==='Send cleaned PNG copy').concat(document.querySelector('[data-conversation-scope] textarea'));return {innerHeight,visualHeight:visualViewport?.height,scrollY,documentHeight:document.documentElement.scrollHeight,elements:nodes.map(node=>{const rect=node.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,height:rect.height}})}})()`);
    assert(desktopComposerBounds.elements.length === 2 && desktopComposerBounds.elements.every(rect=>rect.top>=0&&rect.bottom<=desktopComposerBounds.innerHeight), `The cleaned-copy choice and composer fit on desktop: ${JSON.stringify(desktopComposerBounds)}`);
    const cleanDesktopScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-chat-clean-copy-desktop.png", Buffer.from(cleanDesktopScreenshot.data, "base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: true }); await wait(100);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy').click()`);
    for(let attempt=0;attempt<50&&!await client.evaluate('!!window.__cleanedUpload');attempt++)await wait(50);
    const cleaned = await client.evaluate(`(async()=>{const file=window.__cleanedUpload;if(!file)return null;const bytes=new Uint8Array(await file.arrayBuffer()),bitmap=await createImageBitmap(file),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);const pixel=[...context.getImageData(0,0,1,1).data];bitmap.close();return {name:file.name,type:file.type,width:canvas.width,height:canvas.height,pixel,hasMetadata:new TextDecoder().decode(bytes).includes('metadata-to-remove')}})()`);
    assert.deepEqual(cleaned,{name:'photo-cleaned.png',type:'image/png',width:2,height:2,pixel:[205,52,86,255],hasMetadata:false},'The explicitly requested copy retains the rendered pixels and removes trailing metadata');
    const cleanedBytes = await client.evaluate(`(async()=>btoa(String.fromCharCode(...new Uint8Array(await window.__cleanedUpload.arrayBuffer()))))()`);
    await require('../services/chat-scanner/scanner.cjs').validateStructure(Buffer.from(cleanedBytes, 'base64'), '/dev/shm');
    await client.evaluate(`window.__originalBitmap=window.createImageBitmap;window.createImageBitmap=undefined;window.__cleanedUpload=null;window.__cleanCalls=0`);
    await client.evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;canvas.getContext('2d').fillRect(0,0,1,1);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const input=document.querySelector('[data-conversation-scope] input[type=file]'),files=new DataTransfer();files.items.add(new File([blob],'fallback.png',{type:'image/png'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    for(let attempt=0;attempt<50&&!await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy')`);attempt++)await wait(50);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy').click()`);
    for(let attempt=0;attempt<50&&!await client.evaluate('!!window.__cleanedUpload');attempt++)await wait(50);
    assert.equal(await client.evaluate('window.__cleanedUpload?.name'),'fallback-cleaned.png','The image-element fallback works without createImageBitmap');
    await client.evaluate('window.createImageBitmap=window.__originalBitmap');
    const rotated = await require('sharp')({create:{width:2,height:3,channels:3,background:'#ad4b75'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    await client.evaluate(`window.__cleanedUpload=null;window.__cleanCalls=0;(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(rotated.toString('base64'))}),char=>char.charCodeAt(0)),input=document.querySelector('[data-conversation-scope] input[type=file]'),files=new DataTransfer();files.items.add(new File([bytes],'rotated.jpg',{type:'image/jpeg'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    for(let attempt=0;attempt<50&&!await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy')`);attempt++)await wait(50);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy').click()`);
    for(let attempt=0;attempt<50&&!await client.evaluate('!!window.__cleanedUpload');attempt++)await wait(50);
    assert.deepEqual(await client.evaluate(`(async()=>{const bitmap=await createImageBitmap(window.__cleanedUpload);const size=[bitmap.width,bitmap.height];bitmap.close();return size})()`),[3,2],'Cleaned copies apply EXIF orientation before removing metadata');
    await client.evaluate(`window.__cleanedUpload=null;window.__cleanCalls=0;window.createImageBitmap=undefined;(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(rotated.toString('base64'))}),char=>char.charCodeAt(0)),input=document.querySelector('[data-conversation-scope] input[type=file]'),files=new DataTransfer();files.items.add(new File([bytes],'rotated-fallback.jpg',{type:'image/jpeg'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    for(let attempt=0;attempt<50&&!await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy')`);attempt++)await wait(50);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy').click()`);
    for(let attempt=0;attempt<50&&!await client.evaluate('!!window.__cleanedUpload');attempt++)await wait(50);
    await client.evaluate('window.createImageBitmap=window.__originalBitmap');
    assert.deepEqual(await client.evaluate(`(async()=>{const bitmap=await createImageBitmap(window.__cleanedUpload);const size=[bitmap.width,bitmap.height];bitmap.close();return size})()`),[3,2],'The image-element fallback also applies EXIF orientation');
    await client.evaluate(`window.__cleanCalls=0;window.__releaseBitmap=null;window.createImageBitmap=(...args)=>new Promise(resolve=>{window.__releaseBitmap=()=>window.__originalBitmap(...args).then(resolve)});(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(rotated.toString('base64'))}),char=>char.charCodeAt(0)),input=document.querySelector('[data-conversation-scope] input[type=file]'),files=new DataTransfer();files.items.add(new File([bytes],'scope.jpg',{type:'image/jpeg'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    for(let attempt=0;attempt<50&&!await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy')`);attempt++)await wait(50);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy').click()`);
    for(let attempt=0;attempt<50&&!await client.evaluate('!!window.__releaseBitmap');attempt++)await wait(50);
    await client.evaluate(`[...document.querySelectorAll('aside button')].find(button=>button.textContent.includes('Account support')).click();window.__releaseBitmap();window.createImageBitmap=window.__originalBitmap`); await wait(300);
    assert.equal(await client.evaluate('window.__cleanCalls'),1,'Changing conversations before conversion finishes cannot send the old image into the new conversation');
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?renter=2` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-conversation-scope]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate(`!!document.querySelector('[aria-label="Star customer"], [aria-label="Conversation actions"], [aria-label="Rental management controls"]')`), false, 'Even an incorrectly supplied admin identity cannot expose admin controls to a renter');
    assert.equal(await client.evaluate('document.body.textContent.includes("Private customer")'), false, 'The renter view does not render a supplied admin identity');
    assert.equal(await client.evaluate('!!document.querySelector("[data-private-portrait]")'), false, 'The renter view cannot render a supplied private portrait');
    assert.equal(await client.evaluate(`!!document.querySelector('[aria-label="Add an emoji"]')`), true, 'The renter receives the shared chat presentation');
    assert.equal(await client.evaluate('document.querySelector("[data-conversation-scope]").textContent.includes("Request a human")'), false, 'A human-request button is not shown without an offer');
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?renter=2&catalogue=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-testid=gaffer-catalogue-card]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=gaffer-catalogue-card]").length'), 1, 'A safe catalogue result renders as a chat card');
    assert.match(await client.evaluate('document.querySelector("[data-testid=gaffer-catalogue-card]").textContent'), /Sony FX3 camera.*Open for dates.*£88.00/s, 'The renter card shows the verified date-window quote and availability');
    assert.equal(await client.evaluate('document.querySelector("[data-testid=gaffer-catalogue-card-link]").getAttribute("href")'), '/gear/sony-fx3', 'The card links to the actual catalogue item');
    const catalogueLayout = await client.evaluate(`(()=>{const card=document.querySelector('[data-testid="gaffer-catalogue-card"]').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,left:card.left,right:card.right,width:card.width}})()`);
    assert.equal(catalogueLayout.overflow, false, 'The catalogue card does not widen the chat page');
    const catalogueImage=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync("/tmp/dbc-gaffer-catalogue-card.png",Buffer.from(catalogueImage.data,"base64"));
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?renter=2&handoff=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-testid=human-handoff-offer]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=human-handoff-offer]").length'), 1, 'A structured Gaffer offer produces one chat-native action');
    assert.equal(await client.evaluate('window.__mutationCalls.filter(call=>call.ref==="chat.requestHuman").length'), 0, 'Merely offering help never requests a human');
    await client.evaluate('document.querySelector("[data-testid=human-handoff-offer]").scrollIntoView({block:"center",behavior:"instant"})');await wait(80);const handoffImage=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync("/tmp/dbc-chat-human-offer.png",Buffer.from(handoffImage.data,"base64"));
    await client.evaluate('document.querySelector("[data-testid=human-handoff-offer] button").click()'); await wait(100);
    assert.equal(await client.evaluate('window.__mutationCalls.filter(call=>call.ref==="chat.requestHuman").length'), 1, 'The offer sends only after the renter clicks');
    assert.equal(await client.evaluate('window.__mutationCalls.find(call=>call.ref==="chat.requestHuman").args.token'), "synthetic-renter", 'The handoff uses the renter session');
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=human-handoff-offer] button").length'), 0, 'An accepted offer cannot be clicked twice');
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?renter=2&handoff=1&stale=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-conversation-scope]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=human-handoff-offer]")'), false, 'A newer customer message retires an old offer');
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?renter=2&handoff=1&team=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-conversation-scope]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=human-handoff-offer]")'), false, 'A team-handled conversation cannot offer a duplicate handoff');
    assert.equal(await client.evaluate('document.querySelector("[data-conversation-scope]").textContent.includes("Get back to Gaffer")'), true, 'Customers may resume Gaffer after team handoff');
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?documents=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Insurance retention hold\\"]")'); attempt++) await wait(100);
    await client.evaluate(`document.querySelector('[aria-label="Insurance retention hold"]').click()`); await wait(50);
    assert.equal(await client.evaluate(`window.__mutationCalls.some(call=>call.ref==='verificationArchive.retentionHold')`),false,'Opening the hold review does not release documents');
    assert.match(await client.evaluate(`document.querySelector('[data-testid="retained-documents-page"]').textContent`),/Open insurance claim.*eligible for deletion/s,'The confirmation describes the specific hold and deletion consequence');
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Confirm hold removal').scrollIntoView({block:'center',behavior:'instant'})`);await wait(100);
    const holdScreenshot=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync('/tmp/dbc-retention-hold-review.png',Buffer.from(holdScreenshot.data,'base64'));
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Confirm hold removal').click()`); await wait(50);
    assert.deepEqual(await client.evaluate(`(()=>{const call=window.__mutationCalls.find(item=>item.ref==='verificationArchive.retentionHold');return call?{reason:call.args.reason,expectedReason:call.args.expectedReason,expectedRevision:call.args.expectedRevision,confirmed:call.args.confirmed}:null})()`),{reason:'',expectedReason:'Open insurance claim',expectedRevision:7,confirmed:true},'Only explicit confirmation submits the reviewed hold version');
    await client.cmd("Page.navigate", {url:`http://127.0.0.1:${server.address().port}/?documents=1&retention-review=1`});
    for(let attempt=0;attempt<100&&!await client.evaluate(`document.querySelector('[data-testid="retained-documents-page"]')?.textContent.includes('Retention needs review')`);attempt++)await wait(100);
    const reviewText=await client.evaluate(`document.querySelector('[data-testid="retained-documents-page"]').textContent`);assert.match(reviewText,/Retention needs review/);assert.match(reviewText,/Paused for review/);assert.match(reviewText,/Retention review required/);assert.match(reviewText,/Deletion is paused/);assert.match(reviewText,/Case dates need investigation/);assert.match(reviewText,/linked-booking-fixture/);assert.match(reviewText,/case-fixture/);assert.match(reviewText,/Missing or invalid/);assert.doesNotMatch(reviewText,/Retention ended/,'Protected documents must not be mislabeled as expired');
    await client.evaluate(`[...document.querySelectorAll('strong')].find(node=>node.textContent==='Case dates need investigation').scrollIntoView({block:'center',behavior:'instant'})`);await wait(100);
    const retentionReviewScreenshot=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync('/tmp/dbc-retention-chronology-review.png',Buffer.from(retentionReviewScreenshot.data,'base64'));
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Open linked rental →').click()`);assert.equal(await client.evaluate(`window.__investigateRental`),'linked-booking-fixture','Review opens the actual linked case rental, not the archive source rental');
    await client.evaluate(`window.__mutationCalls=[];document.querySelector('[aria-label="Insurance retention hold"]').click()`);await wait(50);
    assert.equal(await client.evaluate(`window.__mutationCalls.length`),0,'Reviewing an additional hold does not change it');
    await client.evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Case evidence review in progress');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(50);
    await client.evaluate(`document.querySelector('textarea').scrollIntoView({block:'center',behavior:'instant'})`);await wait(50);const holdDuringReviewScreenshot=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync('/tmp/dbc-retention-review-hold.png',Buffer.from(holdDuringReviewScreenshot.data,'base64'));
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Save insurance hold').click()`);await wait(50);
    assert.deepEqual(await client.evaluate(`(()=>{const call=window.__mutationCalls.find(item=>item.ref==='verificationArchive.retentionHold');return call?{reason:call.args.reason,expectedReason:call.args.expectedReason,expectedRevision:call.args.expectedRevision,confirmed:call.args.confirmed}:null})()`),{reason:'Case evidence review in progress',expectedReason:'',expectedRevision:0,confirmed:true},'Only a confirmed, reasoned additional hold is submitted during retention review');
    await client.cmd("Page.navigate", {url:`http://127.0.0.1:${server.address().port}/?credit=1`});
    for(let attempt=0;attempt<100&&!await client.evaluate(`!!document.querySelector('[data-testid="account-credit-submit"]')`);attempt++)await wait(100);
    assert.equal(await client.evaluate(`document.body.textContent.split('Booking adjustment').length-1`),1,'An issued credit appears once, not in duplicate history panels');assert.equal(await client.evaluate(`document.querySelectorAll('[aria-label="Credit history"] article').length`),1,'The single credit ledger retains its downloadable receipt');
    await client.evaluate(`(()=>{window.__creditFail=true;const input=document.querySelector('[aria-label="Credit note"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Private fixture reason');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(50);
    await client.evaluate(`document.querySelector('[data-testid="account-credit-submit"]').click()`);await wait(150);
    const firstCredit=await client.evaluate(`window.__mutationCalls.find(call=>call.ref==='accountCredits.grantAdmin')?.args`);assert(firstCredit,'The direct issue action reaches the account-credit mutation');
    assert.equal(firstCredit.confirmed,undefined,'Issuing account balance does not require a second approval confirmation');
    assert.equal(firstCredit.expectedRevision,0,'The account credit revision fences stale tabs without requiring approval');
    assert.equal(await client.evaluate(`sessionStorage.getItem('dbc-credit-request:account-jordan').includes('Private fixture reason')`),false,'Browser recovery storage never contains the free-text note');
    assert.equal(await client.evaluate(`JSON.parse(sessionStorage.getItem('dbc-credit-request:account-jordan')).amount`),'10','The saved request keeps only the amount and retry identity');
    await client.cmd("Page.reload");for(let attempt=0;attempt<100&&!await client.evaluate(`document.body?.textContent.includes('Request saved')`);attempt++)await wait(100);
    const creditScreenshot=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-credit-recovery-mobile.png',Buffer.from(creditScreenshot.data,'base64'));
    await client.evaluate(`(()=>{const input=document.querySelector('[aria-label="Credit note"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Different note');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-testid="account-credit-submit"]').click()})()`);await wait(150);
    assert.equal(await client.evaluate(`window.__mutationCalls.filter(call=>call.ref==='accountCredits.grantAdmin').length`),0,'A changed note cannot submit a second grant');
    await client.evaluate(`(()=>{const input=document.querySelector('[aria-label="Credit note"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Private fixture reason');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-testid="account-credit-submit"]').click()})()`);await wait(150);
    assert.equal(await client.evaluate(`window.__mutationCalls.find(call=>call.ref==='accountCredits.grantAdmin')?.args.requestId`),firstCredit.requestId,'Reload recovery retries the identical request ID');
    assert.equal(await client.evaluate(`sessionStorage.getItem('dbc-credit-request:account-jordan')`),null,'A confirmed result clears the pending request');
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    await client.cmd("Page.navigate", {url:"http://127.0.0.1:" + server.address().port + "/?renter=2"});
    for(let attempt=0;attempt<100&&!await client.evaluate('!!document.querySelector("[data-conversation-scope]")');attempt++)await wait(50);
    assert.equal(await client.evaluate('!!document.querySelector("[aria-label=\'Chat notifications\']")'),false,'A renter message alone never shows the invitation');
    await client.cmd("Page.navigate", {url:"http://127.0.0.1:" + server.address().port + "/?renter=2&reply=1&notifications-active=1"});await wait(500);
    assert.equal(await client.evaluate('!!document.querySelector("[aria-label=\'Chat notifications\']")'),false,'An already active device is not asked again');
    await client.cmd("Page.navigate", {url:"http://127.0.0.1:" + server.address().port + "/?renter=2&reply=1"});
    for(let attempt=0;attempt<100&&!await client.evaluate('!!document.querySelector("[aria-label=\'Chat notifications\']")');attempt++)await wait(50);
    assert.equal(await client.evaluate('document.querySelector("[data-message-id=gaffer-first-answer]")?.nextElementSibling?.getAttribute("aria-label")'),'Chat notifications','The card follows the first actual Gaffer answer');
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=rental-gaffer-gear-help]")'),true,'Renters can open the live gear assistant from their rental chat');
    await client.evaluate('window.__gafferPrompt="";window.addEventListener("dbc:open-gaffer-chat",event=>window.__gafferPrompt=event.detail?.prompt||"");document.querySelector("[data-testid=rental-gaffer-gear-help]").click()'); await wait(50);
    assert.match(await client.evaluate('window.__gafferPrompt'),/live item cards.*quote.*availability check/i,'The rental shortcut routes into the full live recommendation, quote and availability flow');
    assert.match(await client.evaluate('window.__gafferPrompt'),/Don.t change a booking; a basket is not a reservation/i,'The assistant shortcut preserves booking and stock safety');
    assert.equal(await client.evaluate('window.__gafferPrompt.length<=320'),true,'The prefilled prompt fits the global assistant input limit');
    assert.equal(await client.evaluate('(()=>{const box=document.querySelector("[aria-label=\'Chat notifications\']").getBoundingClientRect();return box.left>=0&&box.right<=innerWidth})()'),true,'The card fits on a phone');
    fs.writeFileSync('/tmp/dbc-chat-alert-card-mobile.png',Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false }); await wait(100);
    assert.equal(await client.evaluate('(()=>{const box=document.querySelector("[aria-label=\'Chat notifications\']").getBoundingClientRect();return box.left>=0&&box.right<=innerWidth})()'),true,'The card fits on desktop');
    fs.writeFileSync('/tmp/dbc-chat-alert-card-desktop.png',Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
    await client.evaluate('window.__alertOpened=0;window.addEventListener("dbc:open-renter-notifications",()=>window.__alertOpened++);[...document.querySelectorAll("[aria-label=\'Chat notifications\'] button")].find(button=>button.textContent==="Turn on notifications").click()'); await wait(100);
    assert.equal(await client.evaluate('window.__alertOpened'),1,'The card opens the existing notification flow');
    assert.equal(await client.evaluate('!!document.querySelector("[aria-label=\'Chat notifications\']")'),false);
    await client.cmd("Page.reload",{});await wait(500);
    assert.equal(await client.evaluate('!!document.querySelector("[aria-label=\'Chat notifications\']")'),false,'The invitation does not reappear after a choice');
    await client.cmd("Page.navigate", {url:"http://127.0.0.1:" + server.address().port + "/?renter=2&reply=1&other=1"});await wait(500);
    assert.equal(await client.evaluate('!!document.querySelector("[aria-label=\'Chat notifications\']")'),false,'The same account is not asked again in another conversation');
    await client.cmd("Page.navigate", {url:"http://127.0.0.1:" + server.address().port + "/?renter=1"});
    for(let attempt=0;attempt<100&&!await client.evaluate('!!document.querySelector("#renter-chat [data-conversation-scope]")');attempt++)await wait(50);
    await wait(500);
    const renterChatLayout=await client.evaluate(`(()=>{const chat=document.querySelector('#renter-chat'),pane=chat?.querySelector('[data-conversation-scope]'),messages=pane?.querySelector('[aria-label="Rental conversation"]'),composer=pane?.querySelector('footer'),chatBox=chat?.getBoundingClientRect(),paneBox=pane?.getBoundingClientRect(),messagesBox=messages?.getBoundingClientRect(),composerBox=composer?.getBoundingClientRect();return chatBox&&paneBox&&messagesBox&&composerBox?{viewport:innerHeight,chatBottom:chatBox.bottom,paneBottom:innerHeight-paneBox.bottom,messagesHeight:messagesBox.height,composerBottom:innerHeight-composerBox.bottom,withTools:pane.classList.contains('withTools')}:null})()`);
    assert(renterChatLayout && !renterChatLayout.withTools, 'The general renter support thread exercises the no-tools layout');
    assert(Math.abs(renterChatLayout.chatBottom-renterChatLayout.viewport)<2 && renterChatLayout.paneBottom>=10 && renterChatLayout.paneBottom<=14, 'The renter chat fills the viewport with only its intentional inner gutter');
    assert(renterChatLayout.messagesHeight>300 && renterChatLayout.composerBottom>=10 && renterChatLayout.composerBottom<=14, 'The message history expands and the composer stays at the bottom');
    fs.writeFileSync('/tmp/dbc-renter-chat-fill-desktop.png',Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", {width:390,height:844,deviceScaleFactor:1,mobile:true});
    await client.cmd("Page.navigate", {url:"http://127.0.0.1:" + server.address().port + "/?renter=1"});
    for(let attempt=0;attempt<100&&!await client.evaluate('!!document.querySelector("#renter-chat [data-conversation-scope]")');attempt++)await wait(50);
    await wait(500);
    const renterMobileLayout=await client.evaluate(`(()=>{const pane=document.querySelector('#renter-chat [data-conversation-scope]'),composer=pane?.querySelector('footer'),messages=pane?.querySelector('[aria-label="Rental conversation"]'),paneBox=pane?.getBoundingClientRect(),composerBox=composer?.getBoundingClientRect(),messagesBox=messages?.getBoundingClientRect();return paneBox&&composerBox&&messagesBox?{viewport:innerHeight,scrollHeight:document.documentElement.scrollHeight,paneBottom:innerHeight-paneBox.bottom,composerTop:composerBox.top,composerBottom:composerBox.bottom,messagesHeight:messagesBox.height}:null})()`);
    assert(renterMobileLayout && renterMobileLayout.scrollHeight<=renterMobileLayout.viewport && renterMobileLayout.paneBottom>=0 && renterMobileLayout.paneBottom<=2, 'The renter support workspace fills the phone without page overflow');
    assert(renterMobileLayout.composerTop<renterMobileLayout.viewport && renterMobileLayout.composerBottom<=renterMobileLayout.viewport && renterMobileLayout.messagesHeight>300, 'The phone shows an anchored composer and an expanded scrollable message area');
    assert.equal(await client.evaluate(`!!document.querySelector('#renter-chat [data-renter-support="true"] button[aria-label="Notification settings"]')`),true,'The compact mobile alerts control stays accessible by name');
    fs.writeFileSync('/tmp/dbc-renter-chat-fill-mobile.png',Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
    console.log("PASS AccountAdmin and renter conversation UI: synthetic rental/customer data with original FX3 and 24–70mm listing images; responsive chat and admin controls.");
  } finally {
    if (client) { client.close(); try { await fetch(`${process.env.DBC_CDP_URL}/json/close/${client.tabId}`); } catch {} }
    if (chrome && chrome.exitCode === null) { const exited = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await exited; }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await wait(300); await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
