import type { Metadata } from "next";
import { SquadContentShell } from "@/components/workspace/content/squad-shell";

// Route group próprio: /w/content/* usa o shell da SQUAD (sidebar troca — D2),
// não o shell do workspace. Mesmo noindex do app autenticado.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function SquadContentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SquadContentShell>{children}</SquadContentShell>;
}
