const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { load, db, put } = require('./lib/rentalTestHarness.cjs');
const {ownerConversationUrl, parseOwnerConversationUrl} = load('shared/ownerConversationRoute.ts');
const chat = load('convex/rentalChat.ts');
const origin='https://dbcinemarentals.com';
const events={},opened=[],shown=[];
let windows=[];
vm.runInNewContext(fs.readFileSync('public/admin-notifications-sw.js','utf8'),{URL,self:{
 location:{origin},addEventListener:(name,fn)=>events[name]=fn,
 registration:{showNotification:async(title,options)=>shown.push({title,options})},
 clients:{matchAll:async()=>windows,openWindow:async url=>opened.push(url)}
}});
async function click(url){let pending;let closed=false;events.notificationclick({notification:{data:{url},close:()=>closed=true},waitUntil:p=>pending=p});if(pending)await pending;assert.ok(closed);}
function client(url,{focused=false,navigable=true,failed=false}={}){const record={url,focused,navigations:[],messages:[],focuses:0};record.navigate=async target=>{if(failed)throw Error('closed');record.navigations.push(target);return navigable?record:null};record.postMessage=payload=>record.messages.push(payload);record.focus=async()=>{record.focuses++;return record};return record;}
(async()=>{
 const rental=ownerConversationUrl({bookingId:'rental-123',accountId:'account-123'});
 const general=ownerConversationUrl({accountId:'account-123'});
 assert.equal(rental,'/admin?rental=rental-123#messages');
 assert.equal(general,'/admin?account=account-123#messages');
 assert.equal(parseOwnerConversationUrl(general,origin).accountId,'account-123');
 for(const url of ['https://evil.example/admin?rental=x#messages','/account?rental=x','/admin?rental=x&account=y','/admin?rental=x&rental=y','/admin?rental=','javascript:alert(1)'])assert.equal(parseOwnerConversationUrl(url,origin),null);
 windows=[];await click(rental);assert.equal(opened.at(-1),origin+rental);
 const shopper=client(origin+'/gear',{focused:true}),owner=client(origin+'/admin');windows=[shopper,owner];await click(general);
 assert.equal(shopper.navigations.length,0,'push must not replace the customer shopping tab');
 assert.equal(owner.navigations.at(-1),origin+general);
 assert.equal(owner.messages.at(-1).url,origin+general,'warm admin receives exact thread even if navigation does not remount React');
 assert.equal(owner.messages.at(-1).type,'dbc:open-owner-conversation');assert.equal(owner.focuses,1);
 const otherOwner=client(origin+'/admin'),focusedOwner=client(origin+'/admin',{focused:true});windows=[otherOwner,focusedOwner];await click(rental);assert.equal(focusedOwner.navigations.length,1);assert.equal(otherOwner.navigations.length,0);
 windows=[client(origin+'/admin',{navigable:false})];await click(general);assert.equal(opened.at(-1),origin+general,'closed/nonnavigable clients fall back to the exact URL');
 windows=[client(origin+'/admin',{failed:true})];await click(rental);assert.equal(opened.at(-1),origin+rental);
 const before=opened.length;for(const url of ['https://evil.example/admin','/account#chat','/admin?rental=x&account=y','/admin?rental=x&rental=y','/admin?rental='])await click(url);assert.equal(opened.length,before);
 let push;events.push({data:{json:()=>({url:general,title:'New message'})},waitUntil:p=>push=p});await push;assert.equal(shown[0].options.data.url,general,'displayed notification retains the scoped destination');
 process.env.ADMIN_TOKEN='fixture-owner-push-links';
 const account=put('accounts',{email:'thread@rental-test.invalid'});
 put('chat_threads',{accountId:account._id,bookingId:undefined,escalated:true,updatedAt:1,unreadOwner:2,lastMessage:'General support fixture'});
 // Resolve directly, independently of the first page and its selected stage.
 const direct=await chat.getGeneralConversation.handler({db},{token:process.env.ADMIN_TOKEN,accountId:account._id});
 assert.equal(direct._id,account._id);assert.equal(direct.status,'support');assert.equal(direct.unreadOwner,2);
 assert.equal(await chat.getGeneralConversation.handler({db},{token:'renter-token',accountId:account._id}),null);
 assert.equal(await chat.getGeneralConversation.handler({db},{token:process.env.ADMIN_TOKEN,accountId:'missing-account'}),null);
 console.log('PASS push chat links: rental/general exact scope, warm/cold/admin login destination, focused admin preference, shopper tab preserved, closed-window fallback, unsafe URLs rejected and owner-only direct thread lookup.');
})().catch(e=>{console.error(e);process.exit(1)});
