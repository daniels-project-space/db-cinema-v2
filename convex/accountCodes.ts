"use node";
import { createHash, randomBytes, randomInt, pbkdf2Sync } from "node:crypto";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sendMail } from "./lib/mailer";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
export const request = action({args:{email:v.string(),name:v.optional(v.string()),phone:v.optional(v.string()),purpose:v.union(v.literal("setup"),v.literal("reset")),cartKey:v.optional(v.string())},handler:async(ctx,a):Promise<{challenge:string}>=>{
 if(a.purpose==="setup"&&(!a.name?.trim()||!a.phone?.trim()))throw Error("Enter your name and phone number.");
 const challenge=randomBytes(32).toString("base64url"),code=String(randomInt(100000,1000000));
 const claim=await ctx.runMutation(internal.accountCodeClaims.prepare,{...a,challengeHash:hash(challenge),codeHash:hash(challenge+":"+code)});
 if(claim){const app=new URL(process.env.APP_URL??"https://dbcinemarentals.com").origin;
  const url=`${app}/account/setup?challenge=${challenge}&purpose=${a.purpose}`;
  if(!await sendMail({to:claim.email,subject:a.purpose==="reset"?"Reset your DB Cinema Rentals password":"Set up your DB Cinema Rentals account",html:`<h2>${a.purpose==="reset"?"Reset your password":"Set up your account"}</h2><p>Your one-time code is <strong>${code}</strong>.</p><p><a href="${url}">Enter your code and choose a new password</a></p><p>The code works once and expires in 15 minutes. Never share it with Gaffer or anyone else. If you did not request this, ignore this email. Your password will only change after you enter the code and choose a new one.</p>`}))throw Error("We could not send your code. Please try again.");
 }
 return {challenge}; // Same response for unknown reset emails and send throttling.
}});
export const verify = action({args:{challenge:v.string(),code:v.string()},handler:async(ctx,a):Promise<{setupToken:string}>=>{
 if(!/^[A-Za-z0-9_-]{43}$/.test(a.challenge)||!/^\d{6}$/.test(a.code))throw Error("Enter the six-digit code from your email.");
 const setupToken=randomBytes(32).toString("base64url");
 const result=await ctx.runMutation(internal.accountCodeClaims.verify,{challengeHash:hash(a.challenge),codeHash:hash(a.challenge+":"+a.code),setupHash:hash(setupToken)});
 if(!result.ok)throw Error("Invalid or expired code. Request a new code if needed.");return {setupToken};
}});
export const complete = action({args:{setupToken:v.string(),password:v.string()},handler:async(ctx,a):Promise<{token:string;cartKey?:string}>=>{
 if(!/^[A-Za-z0-9_-]{43}$/.test(a.setupToken))throw Error("Request a new code.");
 if(a.password.length<8||a.password.length>256)throw Error("Choose a password of 8 to 256 characters.");
 const salt=randomBytes(16).toString("hex"),passwordHash=pbkdf2Sync(a.password,Buffer.from(salt,"hex"),100000,32,"sha256").toString("hex");
 return ctx.runMutation(internal.accountCodeClaims.finish,{setupHash:hash(a.setupToken),salt,hash:passwordHash,sessionToken:randomBytes(32).toString("hex")});
}});
