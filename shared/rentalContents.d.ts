export type RentalContents = { included:string[]; optional:string[]; excluded:string[]; notes:string[]; status:'documented'|'unknown'; sources:{account:string;productId:number;url:string;checkedAt:number;excerpt:string}[] };
export function extractContents(description:string): Omit<RentalContents,'sources'> & {excerpt:string};
export type InventoryFacts = {version:1;contents:string[];optionalContents:string[];reviewRequired:boolean;owned:boolean|null};
export function contentsFor(listing:any): {includes:string[];optional:string[];excludes:string[];notes:string[];contentsStatus:'documented'|'unknown';contentsSources:Omit<RentalContents['sources'][number],'excerpt'>[];inventoryFacts?:InventoryFacts};
export function contentsText(listing:any): string;
