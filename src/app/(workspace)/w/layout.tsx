import type { Metadata } from "next";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

// Mesmo belt-and-suspenders do (dashboard): app autenticado nunca indexa.
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

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
