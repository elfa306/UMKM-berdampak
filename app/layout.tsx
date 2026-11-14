import './globals.css';
import BusinessProfileGate from '@/components/BusinessProfileGate';
import CavaSplash from '@/components/CavaSplash';
import FormA11y from '@/components/FormA11y';
import type { ReactNode } from 'react';
import type { Viewport } from 'next';

export const metadata = {
  title: 'CAVA | Cash Value',
  description: 'Platform pencatatan kas, modal, balik modal, dan nilai kesiapan kredit usaha.',
  openGraph: {
    title: 'CAVA | Cash Value',
    description: 'Platform pencatatan kas, modal, balik modal, dan nilai kesiapan kredit usaha.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#103A57',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#EEF5F1] text-[#103A57] antialiased">
        <FormA11y />
        <CavaSplash />
        <BusinessProfileGate />
        {children}
      </body>
    </html>
  );
}
