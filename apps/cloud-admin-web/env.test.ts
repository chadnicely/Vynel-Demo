import { describe, expect, it } from "vitest";
import { parseCloudAdminWebEnv } from "./env.js";

describe("parseCloudAdminWebEnv", () => {
  it("applies the canonical band when nothing is set", () => {
    const env = parseCloudAdminWebEnv({});

    expect(env.CLOUD_ADMIN_WEB_PORT).toBe(18891);
    expect(env.CLOUD_API_URL).toBe("http://localhost:18890");
  });

  it("VYNEL_PORT_BASE shifts port and proxy target as one band", () => {
    const env = parseCloudAdminWebEnv({ VYNEL_PORT_BASE: "28890" });

    expect(env.CLOUD_ADMIN_WEB_PORT).toBe(28891);
    expect(env.CLOUD_API_URL).toBe("http://localhost:28890");
  });

  it("explicit vars beat the band-derived defaults", () => {
    const env = parseCloudAdminWebEnv({
      VYNEL_PORT_BASE: "28890",
      CLOUD_API_URL: "http://localhost:9000",
    });

    expect(env.CLOUD_API_URL).toBe("http://localhost:9000");
    expect(env.CLOUD_ADMIN_WEB_PORT).toBe(28891);
  });

  it("rejects a non-numeric port so a bad .env fails at boot, not at runtime", () => {
    expect(() =>
      parseCloudAdminWebEnv({ CLOUD_ADMIN_WEB_PORT: "not-a-port" }),
    ).toThrow();
  });
});
