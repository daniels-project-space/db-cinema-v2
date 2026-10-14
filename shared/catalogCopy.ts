/** Stable identities for reviewed catalog copy, independent of object key order.
 * Prices, live availability and images are not edited by a copy update. */
export function canonicalCatalogValue(value:unknown):string{
 const sorted=(v:any):any=>Array.isArray(v)?v.map(sorted):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,sorted(v[k])])):v;
 return JSON.stringify(sorted(value));
}
export function catalogCopyFingerprint(listing:any){
 return canonicalCatalogValue({title:listing.title,productId:listing.hyggloProductId,description:listing.description??null,knowledge:listing.knowledge??null,contents:listing.rentalContents??null,marketingOnly:listing.marketingOnly??false,components:listing.components.map((c:any)=>[String(c.inventoryUnitId),c.qty]).sort((a:any,b:any)=>a[0].localeCompare(b[0]))});
}
