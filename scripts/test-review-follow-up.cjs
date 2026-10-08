/** Actual settlement, invitation, queue and mail handlers; controlled Stripe/SMTP only. */
const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
let now=Date.UTC(2030,0,1),refunds=[],hold={status:'canceled',amount_received:0},providerFails=false,mailOk=true;
Date.now=()=>now;const mails=[];
class Stripe {constructor(){this.refunds={list:()=>({async *[Symbol.asyncIterator](){if(providerFails)throw Error('offline');for(const r of refunds)yield r}})};this.paymentIntents={retrieve:async()=>hold};}}
h.setMock('stripe',{default:Stripe});h.setMock('./referralMail',{unsubscribeToken:()=> 'signed-opt-out'});h.setMock('./lib/mailer',{sendMail:async m=>{mails.push(m);return mailOk}});
const rules=h.load('convex/lib/reviewEligibility.ts'),state=h.load('convex/reviewFollowUpState.ts'),actions=h.load('convex/reviewFollowUp.ts'),invitations=h.load('convex/reviewInvitations.ts'),delivery=h.load('convex/rentalEmailDelivery.ts'),worker=h.load('convex/rentalEmailMail.ts');
const account=h.put('accounts',{email:'current@example.invalid',marketingEmails:false});
process.env.STRIPE_SECRET_KEY='fixture';
const scheduled=[],blobs=new Map();let blobSerial=0,mutations=Promise.resolve();
const ctx={db:h.db,scheduler:{runAfter:async(ms,ref,args)=>scheduled.push({ms,ref,args})},storage:{store:async blob=>{const id='_storage-'+(++blobSerial);blobs.set(id,blob);return id},get:async id=>blobs.get(id),delete:async id=>blobs.delete(id)},runQuery:async(ref,a)=>{
 if(ref==='reviewFollowUpState.candidates')return state.candidates.handler(ctx,a);
 if(ref==='reviewFollowUpState.emailContext')return state.emailContext.handler(ctx,a);
 if(ref==='rentalEmailDelivery.ready')return delivery.ready.handler(ctx,a);
 throw Error('Unexpected query '+ref);
},runMutation:(ref,a)=>{const [group,name]=ref.split('.');const next=mutations.then(()=>({reviewFollowUpState:state,reviewInvitations:invitations,rentalEmailDelivery:delivery})[group][name].handler(ctx,a));mutations=next.catch(()=>{});return next},runAction:async(ref,a)=>{assert.equal(ref,'reviewFollowUp.prepareEmail');return actions.prepareEmail.handler(ctx,a)}};
const base=()=>({accountId:account._id,status:'returned',guestEmail:'old-recycled@example.invalid',depositAmount:100,depositRefunded:true,depositRefundAmount:100,depositKept:0,stripePaymentIntentId:'pi_fixture',stripeDepositIntentId:'pi_hold',depositHoldAmount:200,depositHoldStatus:'released',actualReturnedAt:now-86400000,returnedAt:now-86400000,
 returnDecision:{inspection:[{key:'camera-1',title:'Camera',condition:'good',details:'',openCase:false}]},lineItems:[{start:now-2*86400000,end:now-86400000,qty:1,title:'Fixture camera'}]});
function put(extra={}){return h.put('bookings',{...base(),...extra})}
async function send(b){const row=h.tables.get('rental_email_deliveries').find(r=>r.bookingId===b._id&&r.kind==='review');assert(row);await delivery.dispatchOne.handler(ctx,{deliveryId:row._id});const call=scheduled.findLast(s=>s.ref==='rentalEmailMail.deliver'&&s.args.deliveryId===row._id);await worker.deliver.handler(ctx,call.args);return row}
(async()=>{
 for(const [patch,reason]of [[{status:'active'},'not_returned'],[{depositRefunded:false},'refund_not_settled'],[{depositRefundAmount:99},'partial_refund'],[{depositKept:1},'deposit_retained'],[{depositHoldCapturedForDamage:1},'deposit_retained'],[{returnDecision:{damageKept:1}},'deposit_retained'],[{lateFeePaidFromHold:1},'deposit_retained']])assert.equal(rules.reviewGate({...base(),...patch}),reason);
 refunds=[{id:'re_rental',amount:10000,currency:'gbp',status:'succeeded'}];assert.equal(await actions.providerReviewGate({...base(),rentalRefundIds:['re_rental']},new Stripe()),'refund_pending_or_failed');
 for(const refund of [{amount:10000,currency:'gbp',status:'pending'},{amount:9999,currency:'gbp',status:'succeeded'},{amount:10000,currency:'gbp',status:'failed'}]){refunds=[refund];assert.equal(await actions.providerReviewGate(base(),new Stripe()),'refund_pending_or_failed')}
 refunds=[{amount:10000,currency:'gbp',status:'succeeded'}];hold={status:'requires_capture',amount_received:0};assert.equal(await actions.providerReviewGate(base(),new Stripe()),'hold_release_pending');hold={status:'succeeded',amount_received:100};assert.equal(await actions.providerReviewGate(base(),new Stripe()),'deposit_retained');hold={status:'canceled',amount_received:0};
 assert.equal(await actions.providerReviewGate({...base(),stripePaymentIntentId:undefined},new Stripe()),'refund_unverified');assert.equal(await actions.providerReviewGate({...base(),stripeDepositIntentId:undefined},new Stripe()),'hold_release_unverified');
 const proposed={...base(),unappliedSecurityPayments:['pi_proposal']};
 const provider={
  paymentIntents:{retrieve:async id=>id==='pi_proposal'?{amount_received:12000,status:'succeeded'}:hold},
  refunds:{list:({payment_intent:id})=>({async *[Symbol.asyncIterator](){yield {amount:id==='pi_proposal'?12000:10000,currency:'gbp',status:id==='pi_proposal'?'pending':'succeeded'};}})},
 };
 assert.equal(await actions.providerReviewGate(proposed,provider),'addition_refund_pending_or_failed');
 provider.refunds.list=()=>({async *[Symbol.asyncIterator](){yield {amount:12000,currency:'gbp',status:'succeeded'};}});
 assert.equal(await actions.providerReviewGate(proposed,provider),null);
 const b=put();assert.equal((await actions.processDue.handler(ctx,{})).queued,0);assert.equal(b.reviewFollowUpReason,'post_refund_wait');assert.equal(mails.length,0);
 now+=2*86400000;refunds=[{amount:10000,currency:'gbp',status:'pending'}];await actions.processDue.handler(ctx,{});assert.equal((h.tables.get('rental_email_deliveries')??[]).length,0);
 refunds=[{amount:10000,currency:'gbp',status:'succeeded'}];await Promise.all([actions.processDue.handler(ctx,{}),actions.processDue.handler(ctx,{})]);assert.equal(h.tables.get('rental_email_deliveries').length,1,'Concurrent provider checks queue one event');assert.equal(b.reviewFollowUpStatus,'sending');assert.equal(mails.length,0,'Settlement cron does not send directly');
 let row=await send(b);assert.equal(row.state,'sent');assert.equal(b.remindedReview,true);assert.equal(b.reviewFollowUpStatus,'sent');assert.equal(mails[0].to,account.email,'Permanent account receives email, not the recycled booking email');assert(!mails[0].html.includes('Encore'),'No marketing consent means ordinary review request');assert(mails[0].html.includes('account?rental='+b._id));await actions.processDue.handler(ctx,{});assert.equal(mails.length,1);
 const pending=put({reviewFollowUpDueAt:now-1});providerFails=true;await actions.processDue.handler(ctx,{});assert.equal(pending.reviewFollowUpReason,'provider_unavailable');providerFails=false;
 mailOk=false;await actions.processDue.handler(ctx,{});row=await send(pending);assert.equal(row.state,'pending');assert.equal(pending.reviewFollowUpStatus,'sending');assert.equal(pending.remindedReview,false);const frozen=mails.at(-1).html;now=row.dueAt;mailOk=true;row=await send(pending);assert.equal(row.state,'sent');assert.equal(mails.at(-1).html,frozen);assert.equal(pending.remindedReview,true,'Retry marks completion only after transport accepts');
 await h.db.patch(account._id,{marketingEmails:true});const promo=put({reviewFollowUpDueAt:now-1});await actions.processDue.handler(ctx,{});await send(promo);const mail=mails.at(-1);assert.match(mail.html,/Encore/);assert.match(mail.html,/Every star rating counts equally/);assert.match(mail.html,/2%/);assert.match(mail.html,/4%/);assert.match(mail.html,/10%/);assert.match(mail.html,/Unsubscribe from offers/);assert.match(mail.html,/independent judge/);assert.equal(mail.promotional,true);
 // Any issue or waived late charge suppresses Encore promotions, even without deductions.
 for(const patch of [{returnDecision:{inspection:[{key:'camera-1',condition:'issue',details:'Scuffed casing',openCase:false}]}},{lateFeeAmount:10,lateFeeStatus:'waived'}]){
  const issue=put({...patch,reviewFollowUpDueAt:now-1});await actions.processDue.handler(ctx,{});await send(issue);assert(!mails.at(-1).html.includes('Encore'));assert.equal(mails.at(-1).promotional,false);
 }
 const optout=put({reviewFollowUpDueAt:now-1});await actions.processDue.handler(ctx,{});mailOk=false;row=await send(optout);assert.equal(row.state,'pending');await h.db.patch(account._id,{marketingEmails:false});now=row.dueAt;const count=mails.length;await delivery.dispatchOne.handler(ctx,{deliveryId:row._id});assert.equal(row.state,'skipped');assert.equal(mails.length,count,'A prepared promotional retry cannot bypass a later opt-out');mailOk=true;
 const reviewed=put({reviewFollowUpDueAt:now-1});await actions.processDue.handler(ctx,{});h.put('reviews',{verifiedBookingId:reviewed._id,source:'native',authorAccountId:account._id});row=h.tables.get('rental_email_deliveries').find(r=>r.bookingId===reviewed._id);await delivery.dispatchOne.handler(ctx,{deliveryId:row._id});assert.equal(row.state,'skipped','Already reviewed rental is not reminded');
 const dry=put();const length=h.tables.get('rental_email_deliveries').length;await actions.processDue.handler(ctx,{dryRun:true});assert.equal(dry.reviewFollowUpStatus,undefined);assert.equal(h.tables.get('rental_email_deliveries').length,length);
 console.log('PASS actual durable review invitation: provider refund/hold gates, delayed atomic enqueue, permanent recipient, concurrent dedup, frozen retry/completion, clean Encore offers/all ratings/opt-out, issue/late suppression, reviewed skip and read-only dry run. No customer SMTP or financial writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
