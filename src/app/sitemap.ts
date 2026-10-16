import type {MetadataRoute} from "next";
import {GUIDES} from "@/lib/guides";
import {SITE_URL as BASE} from "@/lib/site";
import {HIRE_CATEGORIES} from "@/lib/hireCategories";
import {discoveryListings} from "@/lib/discovery";
export const revalidate=3600;
export default async function sitemap():Promise<MetadataRoute.Sitemap>{
 const statics=["","/gear","/rental-stories","/membership","/guides","/faq","/how-it-works","/about","/contact","/film-fund","/join","/assemble"].map(path=>({url:`${BASE}${path}`}));
 const guides=GUIDES.map(g=>({url:`${BASE}/guides/${g.slug}`}));
 const rows=await discoveryListings();
 const categories=HIRE_CATEGORIES.filter(c=>rows.some(r=>r.category===c.category)).map(c=>({url:`${BASE}/hire/${c.slug}`}));
 return [...statics,...guides,...categories,...rows.map(r=>({url:`${BASE}/gear/${r.slug}`,lastModified:new Date(r.lastModified),...(r.image?{images:[r.image]}:{})}))];
}
