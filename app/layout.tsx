import type { ReactNode } from 'react';
import './globals.css';
export const metadata = { title: 'Parlay Lab · Daily Sports Research', description: 'Open-source daily sports research, player props and mixed-sport parlay building.' };
export default function RootLayout({ children }: { children: ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
