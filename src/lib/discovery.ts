import "server-only";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";

export type DiscoveryListing={slug:string;title:string;category:string;image:string|null;lastModified:number};
export type DiscoveryOffer={slug:string;title:string;category:string;image:string|null;daily:number|null;minimumRentalDays:number};
// One shared, cached index supports categories, catalogue links and the sitemap.
// The live rental calendar remains authoritative for any selected dates.
const cachedDiscoveryListings=unstable_cache(async(_revision:string):Promise<DiscoveryListing[]>=>{
 const client=new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
 const rows:DiscoveryListing[]=[];let cursor:string|null=null;
 for(let pageNumber=0;pageNumber<100;pageNumber++){
  const result:{page:DiscoveryListing[];isDone:boolean;continueCursor:string}=await client.query(api.catalog.discovery,{paginationOpts:{numItems:200,cursor}});
  rows.push(...result.page);
  if(result.isDone)return rows;
  cursor=result.continueCursor;
 }
 throw Error("Catalogue discovery exceeded its bounded pagination budget");
},["public-catalogue-discovery-v2",process.env.NEXT_PUBLIC_CONVEX_URL!],{revalidate:3600,tags:["catalogue-discovery"]});
export const publicCatalogRevision=cache(()=>new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!).query(api.catalog.publicRevision,{}));
export const discoveryListings=cache(async():Promise<DiscoveryListing[]>=>cachedDiscoveryListings(await publicCatalogRevision()));

// Deduplicate metadata + page reads within one server render.
export const publicListing=cache((slug:string)=>new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!).query(api.catalog.getListingBySlug,{slug}));
export const discoveryOffers=cache((slugs:string[]):Promise<DiscoveryOffer[]>=>new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!).query(api.catalog.discoveryOffers,{slugs}));
export const discoveryCameraPage=cache((after?:string)=>new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!).query(api.catalog.discoveryCameraPage,{...(after?{after}:{})}));
