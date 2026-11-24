const assert=require('node:assert/strict');
const {load,db,put,tables}=require('./lib/rentalTestHarness.cjs');
const reminders=load('convex/rentalChatReminders.ts');
const {londonRentalInstant}=load('shared/rentalWindow.ts');
const scheduled=[],ctx={db,scheduler:{runAfter:async(delay,ref,args)=>{scheduled.push({delay,ref,args});return `job-${scheduled.length}`;}}};
const day=Date.UTC(2032,8,1),pickup=londonRentalInstant(day,'10:00'),realNow=Date.now;
let clock=pickup-7200000;Date.now=()=>clock;
const account=put('accounts',{email:'burst@example.invalid',emailVerifiedAt:clock-10000});
const bookingBase={accountId:account._id,guestEmail:account.email,status:'confirmed',fulfilment:'pickup',paidConfirmedAt:clock-10000,verificationProvider:'didit',idVerificationSource:'didit',idVerifyStatus:'verified',idVerifiedAt:clock-10000,verificationChecks:{identity:'approved',selfie:'approved',address:'approved'},lineItems:[{listingId:'camera',title:'Camera',qty:1,start:day,end:day+86400000,pickupTime:'10:00',returnTime:'18:00'}]};
(async()=>{try{
  for(let index=0;index<120;index++){
    const booking=put('bookings',{...bookingBase,_id:`burst-booking-${index}`});
    await reminders.scheduleRentalChatReminders(ctx,booking);
  }
  const pickupRows=(tables.get('rental_chat_reminders')??[]).filter(row=>row.kind==='pickup');
  assert.equal(pickupRows.length,120);
  clock=pickup-3600000;
  await reminders.recover.handler(ctx,{});
  for(const job of scheduled.splice(0).filter(job=>job.delay===0&&job.ref==='rentalChatReminders.deliver'))await reminders.deliver.handler(ctx,job.args);
  assert.equal(pickupRows.filter(row=>row.state==='sent').length,50,'first bounded recovery advances its first 50');
  await reminders.recover.handler(ctx,{});
  for(const job of scheduled.splice(0).filter(job=>job.delay===0&&job.ref==='rentalChatReminders.deliver'))await reminders.deliver.handler(ctx,job.args);
  await reminders.recover.handler(ctx,{});
  for(const job of scheduled.splice(0).filter(job=>job.delay===0&&job.ref==='rentalChatReminders.deliver'))await reminders.deliver.handler(ctx,job.args);
  assert.equal(pickupRows.filter(row=>row.state==='sent').length,120,'120 due reminders finish within the grace window across bounded batches');
  await reminders.recover.handler(ctx,{});
  await reminders.deliver.handler(ctx,{reminderId:pickupRows[0]._id});
  const messages=(tables.get('messages')??[]).filter(row=>row.meta?.kind==='rental_chat_reminder');
  assert.equal(messages.length,120,'overlapping sequential sweeps and a direct delivery replay never duplicate a reminder');
  assert.equal(new Set(messages.map(message=>message.bookingId)).size,120);
  for(let attempt=0;attempt<8;attempt++)await reminders.backfill.handler(ctx,{});
  const migrations=tables.get('rental_chat_reminder_migrations')??[];
  assert.equal(migrations.length,1,'repeated initial sweep entries share one migration cursor');
  assert.equal(migrations[0].status,'complete','the bounded migration advances through both booking states');
  assert.equal((tables.get('rental_chat_reminders')??[]).filter(row=>row.kind==='pickup').length,120,'replayed backfill never creates duplicate occurrences');
  console.log('PASS independent reminder burst: 120 due occurrences, bounded recovery, replay and one-time migration.');
}finally{Date.now=realNow;}})().catch(error=>{console.error(error);process.exitCode=1;});
