import type { Metadata } from 'next';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/fraunces';
import './globals.css';

export const metadata: Metadata = {
  title: 'EchoSpeak — Voice Mimicry Studio',
  description: 'A private practice studio for listening, shadowing and learning a speaker’s delivery.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: `try{let t=localStorage.getItem('echospeak-theme')||'light';document.documentElement.dataset.theme=t==='system'?(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):t}catch{}` }} />
        {children}
      </body>
    </html>
  );
}
