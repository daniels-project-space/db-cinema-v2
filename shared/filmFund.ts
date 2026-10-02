import { membershipActiveNow, membershipTierFor } from "./membership";
export const FILM_FUND_TERMS_VERSION = "2026-10-film-fund-v2";
export const FILM_FUND_ENTRY_PENCE = 3000;
export const FUND_ROUNDS = [
  { slug: "spring-2027", name: "Spring 2027", state: "coming_soon" as const, opensAt: Date.UTC(2027,0,15,9), deadline: Date.UTC(2027,2,31,22,59), announcementAt: Date.UTC(2027,3,15,11) },
  { slug: "autumn-2027", name: "Autumn 2027", state: "coming_soon" as const, opensAt: Date.UTC(2027,6,15,8), deadline: Date.UTC(2027,8,30,22,59), announcementAt: Date.UTC(2027,9,15,11) },
];
export function wordCount(text: string) { return text.trim().split(/\s+/u).filter(Boolean).length; }
export function fundProjectKey(title: string) { return title.normalize("NFKC").toLowerCase().trim().replace(/\s+/g," "); }
export function fundSubmissionErrors(p: {title:string;synopsis:string;letter:string;crew:{name:string;role:string;profile:string;bio:string}[];scriptId?:unknown;moodboardId?:unknown;videoId?:unknown;documentIds:unknown[]}) {
 const errors:string[]=[];
 if(p.title.trim().length<3)errors.push("Project title is required.");
 if(p.synopsis.trim().length<50)errors.push("Add a synopsis of at least 50 characters.");
 if(wordCount(p.letter)!==250)errors.push("Your bio / creative letter must contain 250 words.");
 if(!p.crew.length||p.crew.some(c=>c.name.trim().length<2||c.role.trim().length<2||c.bio.trim().length<20||!/^https:\/\//i.test(c.profile)))errors.push("Add crew names, roles, HTTPS profile links and bios (at least 20 characters).");
 if(!p.scriptId)errors.push("Upload your script.");
 if(!p.moodboardId)errors.push("Upload your moodboard.");
 if(!p.documentIds.length)errors.push("Upload your supporting production document.");
 if(!p.videoId)errors.push("Upload your one-minute pitch video.");
 return errors;
}

export function fundEntryPence(account:any){return membershipTierFor(account)==="plus"&&membershipActiveNow(account)?1500:FILM_FUND_ENTRY_PENCE;}
