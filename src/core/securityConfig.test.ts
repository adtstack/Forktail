import { describe, expect, it } from "vitest";
import tauriConfig from "../../src-tauri/tauri.conf.json";

interface TauriSecurityConfig {
  app?: {
    security?: {
      csp?: unknown;
      devCsp?: unknown;
    };
  };
}

const config = tauriConfig as TauriSecurityConfig;

describe("Tauri security config", () => {
  it("pins a release CSP instead of disabling it", () => {
    const csp = config.app?.security?.csp;

    expect(typeof csp).toBe("string");
    expect(csp).not.toBe("");
    expect(csp).not.toBeNull();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("connect-src ipc: http://ipc.localhost");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("https:");
    expect(csp).not.toContain("http://localhost:1420");
  });

  it("keeps development-only server allowances out of release CSP", () => {
    const csp = config.app?.security?.csp as string;
    const devCsp = config.app?.security?.devCsp;

    expect(typeof devCsp).toBe("string");
    expect(devCsp).toContain("http://localhost:1420");
    expect(devCsp).toContain("ws://localhost:1420");
    expect(csp).not.toContain("ws://localhost:1420");
  });
});
