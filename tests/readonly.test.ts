import { describe, expect, it, vi } from "vitest";
import {
  advisorsUrl,
  ForbiddenUrlError,
  isAllowedUrl,
  isValidProjectRef,
  metricsAuthHeader,
  metricsUrl,
  readOnlyGet,
  redact,
} from "../supabase/functions/_shared/core/readonly.ts";

const REF = "abcdefghijklmnopqrst";

describe("project_ref", () => {
  it("aceita 20 letras minúsculas", () => expect(isValidProjectRef(REF)).toBe(true));
  it.each(["ABCDEFGHIJKLMNOPQRST", "abc", "abcdefghijklmnopqrs1", "abcdefghijklmnopqrst.evil.com"])(
    "rejeita %s",
    (ref) => expect(isValidProjectRef(ref)).toBe(false),
  );
  it("metricsUrl/advisorsUrl rejeitam ref inválido", () => {
    expect(() => metricsUrl("x")).toThrow();
    expect(() => advisorsUrl("x", "security")).toThrow();
  });
});

describe("allowlist somente leitura", () => {
  it("permite os endpoints documentados", () => {
    expect(isAllowedUrl(metricsUrl(REF))).toBe(true);
    expect(isAllowedUrl(advisorsUrl(REF, "security"))).toBe(true);
    expect(isAllowedUrl(advisorsUrl(REF, "performance"))).toBe(true);
  });
  it.each([
    `https://api.supabase.com/v1/projects/${REF}/database/query`,
    `https://api.supabase.com/v1/projects/${REF}/pause`,
    `https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`,
    `https://${REF}.supabase.co/rest/v1/users`,
    `http://${REF}.supabase.co/customer/v1/privileged/metrics`,
    `https://${REF}.supabase.co.evil.com/customer/v1/privileged/metrics`,
  ])("bloqueia %s", (url) => expect(isAllowedUrl(url)).toBe(false));

  it("readOnlyGet lança ForbiddenUrlError fora da allowlist e não chama fetch", async () => {
    const f = vi.fn();
    await expect(readOnlyGet("https://example.com", {}, { fetchImpl: f })).rejects.toBeInstanceOf(ForbiddenUrlError);
    expect(f).not.toHaveBeenCalled();
  });

  it("readOnlyGet sempre usa GET", async () => {
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    const r = await readOnlyGet(metricsUrl(REF), {}, { fetchImpl: f });
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledWith(metricsUrl(REF), expect.objectContaining({ method: "GET" }));
  });

  it("falha de rede não lança: devolve ok=false", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("network");
    });
    const r = await readOnlyGet(metricsUrl(REF), {}, { fetchImpl: f });
    expect(r).toMatchObject({ ok: false, status: 0, error: "falha de rede" });
  });
});

describe("credenciais", () => {
  it("Basic auth usa usuário service_role", () => {
    const h = metricsAuthHeader("sb_secret_123456789");
    expect(atob(h.Authorization.replace("Basic ", ""))).toBe("service_role:sb_secret_123456789");
  });
  it("redact remove segredos do texto", () => {
    expect(redact("token=sb_secret_abcdefgh fim", ["sb_secret_abcdefgh"])).toBe("token=[REDACTED] fim");
  });
});
