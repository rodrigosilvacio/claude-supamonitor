import { describe, expect, it } from "vitest";
import { availabilityPct, daysToQuota, formatBytes, pctTone } from "../frontend/src/lib/metrics.ts";

describe("utilidades de métricas do frontend", () => {
  it("disponibilidade = scrapes ok / total", () => {
    expect(availabilityPct([{ scrapes: 60, scrapes_ok: 60 }, { scrapes: 60, scrapes_ok: 57 }])).toBe(97.5);
    expect(availabilityPct([])).toBeNull();
  });
  it("tom do farol percentual (80% atenção, 95% crítico)", () => {
    expect(pctTone(50)).toBe("good");
    expect(pctTone(80)).toBe("warning");
    expect(pctTone(96)).toBe("critical");
    expect(pctTone(null)).toBeUndefined();
  });
  it("projeção de dias até a cota", () => {
    const GB = 1024 ** 3;
    const pts = [{ bucket: "2026-11-01T00:00:00Z", db_size_bytes: 0.2 * GB }, { bucket: "2026-11-11T00:00:00Z", db_size_bytes: 0.3 * GB }];
    expect(daysToQuota(pts, 0.5 * GB)).toBe(20);
    expect(daysToQuota(pts, null)).toBeNull();
    expect(daysToQuota([pts[0], { ...pts[1], db_size_bytes: 0.2 * GB }], 0.5 * GB)).toBeNull();
  });
  it("formata bytes", () => {
    expect(formatBytes(125829120)).toBe("120 MB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
    expect(formatBytes(null)).toBe("–");
  });
});
