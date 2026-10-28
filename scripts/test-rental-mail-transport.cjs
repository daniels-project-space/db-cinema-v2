/** Actual transport inputs under controlled SMTP/HTTP; no network deliveries. */
const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const configurations=[],envelopes=[],requests=[];let accepted=[];
h.setMock('nodemailer',{default:{createTransport:config=>{configurations.push(config);return {sendMail:async m=>{envelopes.push(m);return {accepted}}}}}});
const {sendMail,supportEmailFrom}=h.load('convex/lib/mailer.ts');const original=global.fetch;
Object.assign(process.env,{GMAIL_USER:'qa@example.invalid',GMAIL_APP_PASSWORD:'qa-unused',RESEND_API_KEY:'qa-unused'});
delete process.env.SUPPORT_EMAIL_FROM;
global.fetch=async(url,options)=>{requests.push({url,options});return new Response('{}',{status:200})};
(async()=>{try{
 const supportFrom=supportEmailFrom();assert.equal(supportFrom,'Bookings <bookings@dbcinemarentals.com>');
 const m={from:supportFrom,to:'customer@example.invalid',cc:['dbcinemarentals@gmail.com'],subject:'Runtime QA',html:'<p>QA</p>',deliveryKey:'bookings-qa:payment:1'};
 assert.equal(await sendMail(m),true);assert.equal(requests.length,1,'SMTP accepting no recipient must fall back rather than claim success');assert.equal(requests[0].options.headers['Idempotency-Key'],m.deliveryKey);assert(requests[0].options.signal);const resendPayload=JSON.parse(requests[0].options.body);assert.equal(resendPayload.from,supportFrom);assert.deepEqual(resendPayload.cc,m.cc);
 const messageId=envelopes[0].messageId;accepted=[m.to];assert.equal(await sendMail(m),true);assert.equal(requests.length,1);assert.equal(envelopes[1].messageId,messageId,'SMTP retry uses stable Message-ID');assert.equal(envelopes[1].from,supportFrom);assert.deepEqual(envelopes[1].cc,m.cc);assert(configurations.every(c=>c.connectionTimeout===20000&&c.greetingTimeout===20000&&c.socketTimeout===60000));
 accepted=[];delete process.env.RESEND_API_KEY;assert.equal(await sendMail(m),false,'No accepted recipient and no fallback must remain a failure');
 console.log('PASS actual mail transport: support sender and CC are preserved across SMTP and Resend fallback, with bounded timeouts, stable Message-ID and Resend idempotency key. No network or customer sends.');
}finally{global.fetch=original;delete process.env.GMAIL_USER;delete process.env.GMAIL_APP_PASSWORD;delete process.env.RESEND_API_KEY;delete process.env.SUPPORT_EMAIL_FROM}})().catch(e=>{console.error(e);process.exitCode=1});
