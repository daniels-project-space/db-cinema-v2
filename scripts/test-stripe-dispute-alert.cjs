const assert=require('node:assert/strict'),Stripe=require('stripe'),h=require('./lib/rentalTestHarness.cjs');
const realWebhooks=new Stripe('sk_test_fixture').webhooks;
class StripeFixture { webhooks=realWebhooks; }
h.setMock('stripe',{default:StripeFixture});
const checkout=h.load('convex/checkout.ts'),disputes=h.load('convex/stripeDisputes.ts'),presentation=h.load('shared/adminNotificationPresentation.ts');
process.env.STRIPE_SECRET_KEY='sk_test_fixture';process.env.STRIPE_WEBHOOK_SECRET='whsec_synthetic';
delete process.env.RMV2_WEBHOOK_URL;delete process.env.RMV2_WEBHOOK_SECRET;
const scheduled=[],ctx={db:h.db,scheduler:{runAfter:async(delay,ref,args)=>scheduled.push({delay,ref,args})},runMutation:async(ref,args)=>{
 if(ref==='stripeDisputes.record')return disputes.record.handler(ctx,args);
 throw Error(`Unexpected mutation ${ref}`);
}};
function event(id,type,intent){const body=JSON.stringify({id,type,data:{object:{id:'dp_fixture',payment_intent:intent}}});return {body,sig:realWebhooks.generateTestHeaderString({payload:body,secret:process.env.STRIPE_WEBHOOK_SECRET})};}
(async()=>{
 const account=h.put('accounts',{email:'synthetic@example.invalid'}),booking=h.put('bookings',{accountId:account._id,status:'confirmed',stripePaymentIntentId:'pi_unique',depositAmount:20,total:100,agreementSnapshot:'unchanged'});
 h.put('admin_push_subscriptions',{enabled:true,deviceId:'synthetic',updatedAt:1,endpoint:'https://synthetic.invalid',p256dh:'fixture',auth:'fixture'});
 const created=event('evt_synthetic_created','charge.dispute.created','pi_unique');
 assert.equal(await checkout.stripeWebhook.handler(ctx,{...created,body:created.body+' '}),false);
 assert.equal((h.tables.get('admin_notifications')??[]).length,0,'invalid signature has no effect');
 assert.equal(await checkout.stripeWebhook.handler(ctx,created),true);assert.equal(await checkout.stripeWebhook.handler(ctx,created),true);
 let rows=h.tables.get('admin_notifications');assert.equal(rows.length,1,'redelivery is deduplicated');
 assert.equal(rows[0].bookingId,booking._id);assert.equal(rows[0].accountId,account._id);assert.equal(rows[0].title,'Stripe dispute opened');
 assert.equal(presentation.adminNotificationCategory(rows[0].kind),'Bookings & payments');
 assert.equal((h.tables.get('admin_push_deliveries')??[]).length,1,'one owner push is queued');
 const updated=event('evt_synthetic_updated','charge.dispute.updated',null);
 assert.equal(await checkout.stripeWebhook.handler(ctx,updated),true);rows=h.tables.get('admin_notifications');assert.equal(rows[1].bookingId,undefined);assert.match(rows[1].body,/affected payment/);
 h.put('bookings',{accountId:account._id,status:'confirmed',stripePaymentIntentId:'pi_unique',depositAmount:0,total:5,agreementSnapshot:'other'});
 const closed=event('evt_synthetic_closed','charge.dispute.closed','pi_unique');
 assert.equal(await checkout.stripeWebhook.handler(ctx,closed),true);assert.equal(rows[2].bookingId,undefined,'ambiguous payment ownership is not guessed');
 await assert.rejects(disputes.record.handler(ctx,{eventId:'bad-event',eventType:'charge.dispute.created'}),/Invalid dispute event/);
 assert.equal(booking.agreementSnapshot,'unchanged');assert.equal(booking.status,'confirmed');assert.equal(booking.depositAmount,20);assert.equal(booking.total,100);
 assert(!JSON.stringify(rows).includes('pi_unique'),'payment reference is not exposed in notification copy');
 assert(scheduled.some(job=>job.ref==='adminPushDelivery.deliver'));
 console.log('PASS signed synthetic disputes: three event types, deduplication, owner push queue, unknown/ambiguous mapping, invalid signatures and unchanged payment terms.');
})().catch(error=>{console.error(error);process.exitCode=1});
