import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Veilnivo — Your words. Your control.',
  applicationName: 'Veilnivo',
  description: 'An encrypted messenger. No phone number. No email. Just you.',
  icons: { icon: '/icon.svg' },
};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
