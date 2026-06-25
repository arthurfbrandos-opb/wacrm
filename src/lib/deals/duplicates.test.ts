import { describe, it, expect } from "vitest";
import type { DealStatus } from "@/types";
import { duplicateContactIds, diffSnapshots, buildUnifyPatch } from "./duplicates";

const snap = (o: Record<string, unknown>) => o as never;

describe("duplicateContactIds", () => {
  it("flags contacts with >=2 open snapshot deals", () => {
    const deals: Array<{ contact_id: string; status: DealStatus; fap01_snapshot: unknown }> = [
      { contact_id: "c1", status: "open", fap01_snapshot: snap({ nicho: "a" }) },
      { contact_id: "c1", status: "open", fap01_snapshot: snap({ nicho: "b" }) },
      { contact_id: "c2", status: "open", fap01_snapshot: snap({ nicho: "x" }) },
    ];
    const set = duplicateContactIds(deals as any);
    expect(set.has("c1")).toBe(true);
    expect(set.has("c2")).toBe(false);
  });

  it("ignores manual deals (no snapshot) and non-open deals", () => {
    const deals: Array<{ contact_id: string; status: DealStatus; fap01_snapshot: unknown }> = [
      { contact_id: "c1", status: "open", fap01_snapshot: snap({ nicho: "a" }) },
      { contact_id: "c1", status: "open", fap01_snapshot: null },
      { contact_id: "c3", status: "open", fap01_snapshot: snap({ nicho: "a" }) },
      { contact_id: "c3", status: "won", fap01_snapshot: snap({ nicho: "b" }) },
    ];
    const set = duplicateContactIds(deals as any);
    expect(set.has("c1")).toBe(false);
    expect(set.has("c3")).toBe(false);
  });
});

describe("diffSnapshots", () => {
  it("marks divergent fields", () => {
    const rows = diffSnapshots(
      snap({ nicho: "odonto", faturamento_range: "30-80k", contact_name: "A" }),
      snap({ nicho: "clínica", faturamento_range: "30-80k", contact_name: "A" }),
    );
    const nicho = rows.find((r) => r.key === "nicho")!;
    const fat = rows.find((r) => r.key === "faturamento_range")!;
    expect(nicho.diverges).toBe(true);
    expect(fat.diverges).toBe(false);
  });
});

describe("buildUnifyPatch", () => {
  it("applies choices: 'old' reverts the field, 'new' keeps current", () => {
    const oldS = snap({ contact_name: "Antigo", contact_email: "a@x.com", company_name: "AC", nicho: "odonto" });
    const newS = snap({ contact_name: "Novo", contact_email: "n@x.com", company_name: "NC", nicho: "clínica" });
    const patch = buildUnifyPatch(oldS, newS, { contact_name: "old", nicho: "new" });
    expect(patch.name).toBe("Antigo");
    expect(patch.fap01_data.nicho).toBe("clínica");
    // unchosen fields default to new
    expect(patch.email).toBe("n@x.com");
    expect(patch.company).toBe("NC");
    // fap01_data base = new snapshot (UTM/attribution = latest)
    expect(patch.fap01_data.contact_name).toBe("Antigo");
  });
});
