import type {Metadata} from "next";
export const metadata:Metadata={manifest:"/admin.webmanifest",appleWebApp:{capable:true,title:"DB Cinema Admin",statusBarStyle:"black-translucent"},icons:{apple:"/db-cinema-logo-512.png"},robots:{index:false,follow:false,noarchive:true}};
export default function AdminLayout({children}:{children:React.ReactNode}){return children;}
