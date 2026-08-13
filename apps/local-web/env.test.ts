import { describe, expect, it } from "vitest";
import { parseLocalWebEnv } from "./env.js";

describe("parseLocalWebEnv", () => {
  it("applies defaults when nothing is set", () => {
    const env = parseLocalWebEnv({});

    expect(env.LOCAL_WEB_PORT).toBe(18894);
    expect(env.LOCAL_API_URL).toBe("http://127.0.0.1:18892");
  });

  it("coerces the port and accepts overrides", () => {
    const env = parseLocalWebEnv({
      LOCAL_WEB_PORT: "9100",
      LOCAL_API_URL: "http://127.0.0.1:9000",
    });

    expect(env.LOCAL_WEB_PORT).toBe(9100);
    expect(env.LOCAL_API_URL).toBe("http://127.0.0.1:9000");
  });

  it("rejects a non-numeric port so a bad .env fails at boot, not at runtime", () => {
    expect(() => parseLocalWebEnv({ LOCAL_WEB_PORT: "not-a-port" })).toThrow();
  });

  it("VYNEL_PORT_BASE shifts port and URL defaults as one band", () => {
    const env = parseLocalWebEnv({ VYNEL_PORT_BASE: "28890" });

    expect(env.LOCAL_WEB_PORT).toBe(28894);
    expect(env.LOCAL_API_URL).toBe("http://127.0.0.1:28892");
    expect(env.VYNEL_VOICE_DAEMON_URL).toBe("http://127.0.0.1:28893");
  });

  it("explicit vars beat the band-derived defaults", () => {
    const env = parseLocalWebEnv({
      VYNEL_PORT_BASE: "28890",
      LOCAL_WEB_PORT: "9100",
    });

    expect(env.LOCAL_WEB_PORT).toBe(9100);
    expect(env.LOCAL_API_URL).toBe("http://127.0.0.1:28892");
  });
});
