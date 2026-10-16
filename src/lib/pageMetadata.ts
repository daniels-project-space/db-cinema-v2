import type {Metadata} from 'next';
import {SITE_URL} from './site';
export function publicPageMetadata(path:string,title:string,description:string):Metadata{
 return {title,description,alternates:{canonical:path},openGraph:{title:`${title} | DB Cinema Rentals`,description,url:`${SITE_URL}${path}`},twitter:{card:'summary_large_image',title,description}};
}
