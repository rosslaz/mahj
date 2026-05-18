import './globals.css';
import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import UserMenu from '@/components/UserMenu';
import InstallPrompt from '@/components/InstallPrompt';

export const metadata: Metadata = {
  title: 'Mahjong League',
  description: 'Track game nights, scores and standings for your mahjong league.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Mahjong League' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
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
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-12 bg-bone tile-border flex items-center justify-center">
                <span className="font-display text-2xl text-jade font-semibold">發</span>
              </div>
              <div>
                <div className="font-display text-2xl leading-none tracking-tight">Mahjong League</div>
                <div className="text-[10px] tracking-[0.3em] uppercase text-ink/50 mt-1">platform</div>
              </div>
            </Link>
            <div className="flex items-center gap-6 text-sm">
              <Link href="/leagues" className="hidden sm:inline hover:text-cinnabar transition-colors">My Leagues</Link>
              <UserMenu />
            </div>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-10">{children}</main>
        <footer className="max-w-6xl mx-auto px-6 py-10 mt-10 border-t border-ink/10 text-xs text-ink/40 tracking-[0.2em] uppercase text-center">
          Four winds · Three dragons · One platform
        </footer>
        <InstallPrompt />
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
