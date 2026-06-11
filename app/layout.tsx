import './globals.css';
import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import UserMenu from '@/components/UserMenu';
import InstallPrompt from '@/components/InstallPrompt';
import AppBadgeManager from '@/components/AppBadgeManager';
import LegalGate from '@/components/LegalGate';

export const metadata: Metadata = {
  title: 'Pungctual',
  description: 'Run mahjong clubs — leagues, tournaments, classes, open play.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Pungctual' },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#1a1410',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Outfit:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="border-b border-ink/15">
          <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
            <Link href="/" className="flex items-center group" aria-label="Pungctual home">
              <Image
                src="/pungctual-logo.png"
                alt="Pungctual — mahjong scheduling"
                width={300}
                height={129}
                priority
                className="h-12 md:h-14 w-auto"
              />
            </Link>
            <div className="flex items-center gap-6 text-sm">
              <UserMenu />
            </div>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-10">{children}</main>
        <footer className="max-w-6xl mx-auto px-6 py-10 mt-10 border-t border-ink/10 text-xs text-ink/40 tracking-[0.2em] uppercase text-center space-y-3">
          <div>Four winds · Three dragons · One Pungctual</div>
          <div className="space-x-4 normal-case tracking-[0.15em] text-[11px]">
            <a href="mailto:support@pungctual.com" className="hover:text-cinnabar">Contact</a>
            <span className="text-ink/20">·</span>
            <Link href="/terms" className="hover:text-cinnabar">Terms</Link>
            <span className="text-ink/20">·</span>
            <Link href="/privacy" className="hover:text-cinnabar">Privacy</Link>
            <span className="text-ink/20">·</span>
            <Link href="/acceptable-use" className="hover:text-cinnabar">Acceptable Use</Link>
          </div>
          {process.env.NEXT_PUBLIC_APP_VERSION && (
            <div className="text-[10px] text-ink/30 tracking-[0.25em] normal-case">
              v{process.env.NEXT_PUBLIC_APP_VERSION}
            </div>
          )}
        </footer>
        <InstallPrompt />
        <AppBadgeManager />
        <LegalGate />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', async () => {
                  try {
                    const reg = await navigator.serviceWorker.register('/sw.js');
                    // Check for updates on every load so deploys take effect promptly
                    reg.update().catch(() => {});
                    // Reload when a new SW takes control
                    let refreshing = false;
                    navigator.serviceWorker.addEventListener('controllerchange', () => {
                      if (refreshing) return;
                      refreshing = true;
                      window.location.reload();
                    });
                  } catch (e) { console.error('SW registration failed:', e); }
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
