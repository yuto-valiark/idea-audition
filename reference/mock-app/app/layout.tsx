import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'IDEA AUDITION — AIがプレゼン。あなたが審査員。',description:'AIのアイデアを、みんなで審査し、育て、最高の1案を決める。'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ja"><body>{children}</body></html>}
