import { EmailedCart } from "@/components/cart/EmailedCart";
export const metadata={title:"Your rental cart | DB Cinema Rentals",robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{shareKey:string}>}){const {shareKey}=await params;return <EmailedCart shareKey={shareKey}/>;}
