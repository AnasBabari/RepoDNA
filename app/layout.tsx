import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://repodna.anas-babari.chatgpt.site'),
  title: 'RepoDNA — Understand any codebase visually',
  description: 'Map routes, services, dependencies, databases and execution paths without executing repository code.',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
  },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'RepoDNA',
    title: 'RepoDNA — Understand any codebase visually',
    description: 'Map routes, services, dependencies, databases and execution paths without executing repository code.',
    images: [{ url: '/og.png', width: 1733, height: 911, alt: 'RepoDNA architecture map' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RepoDNA — Understand any codebase visually',
    description: 'Map routes, services, dependencies, databases and execution paths without executing repository code.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
