export type RentalContents = { included:string[]; optional:string[]; excluded:string[]; notes:string[]; status:'documented'|'unknown'; sources:{account:string;productId:number;url:string;checkedAt:number;excerpt:string}[] };
export function extractContents(description:string): Omit<RentalContents,'sources'> & {excerpt:string};
export function contentsFor(listing:any): {includes:string[];optional:string[];excludes:string[];notes:string[];contentsStatus:'documented'|'unknown';contentsSources:Omit<RentalContents['sources'][number],'excerpt'>[]};
export function contentsText(listing:any): string;
