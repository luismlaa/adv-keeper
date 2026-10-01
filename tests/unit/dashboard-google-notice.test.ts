import { describe, expect, it } from "vitest";
import { googleConnectNotice } from "@/lib/dashboard/google-notice";

describe("googleConnectNotice", () => {
  it("shows success after connecting and nothing without the param", () => {
    expect(googleConnectNotice({ google: "conectado" })).toMatchObject({ tone: "success" });
    expect(googleConnectNotice({})).toBeNull();
    expect(googleConnectNotice({ google: "otro" })).toBeNull();
  });

  it("explains known reasons and falls back to a generic error for internal ones", () => {
    expect(googleConnectNotice({ google: "error", reason: "denied" })?.text).toMatch(/Cancelaste/);
    expect(googleConnectNotice({ google: "error", reason: "demo" })?.text).toMatch(/demo/);
    expect(googleConnectNotice({ google: "error", reason: "bad_signature" })).toEqual({ tone: "error", text: "No se pudo conectar Google Calendar. Vuelve a intentarlo." });
    expect(googleConnectNotice({ google: ["error"], reason: ["expired", "x"] })?.text).toMatch(/venció/);
  });
});
