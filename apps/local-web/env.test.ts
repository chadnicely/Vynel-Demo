import { describe, expect, it } from "vitest";
import { parseLocalWebEnv } from "./env.js";

describe("parseLocalWebEnv", () => {
  it("applies defaults when nothing is set", () => {
    const env = parseLocalWebEnv({});

    expect(env.LOCAL_WEB_PORT).toBe(8999);
    expect(env.LOCAL_API_URL).toBe("http://127.0.0.1:8998");
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
});
