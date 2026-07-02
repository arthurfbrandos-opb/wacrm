"use client";

// Peças da Squad Content (conta atual). Client no effect (prerender-safe).
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadPieces } from "@/lib/workspace/content-queries";
import type { ContentPiece } from "@/lib/workspace/content";

export function useContentPieces() {
  const [pieces, setPieces] = useState<ContentPiece[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    loadPieces(supabase)
      .then((rows) => {
        if (alive) setPieces(rows);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  return { pieces, error };
}
