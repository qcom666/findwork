import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { clientIp } from "../src/lib/ratelimit";

const req = (headers: Record<string, string>) => new Request("https://lidomap.ru/api/auth/login", { headers });

afterEach(() => {
  delete process.env.PROXY_SECRET;
});

describe("IP посетителя за прокси", () => {
  it("без прокси берёт первый адрес из X-Forwarded-For", () => {
    assert.equal(clientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })), "1.2.3.4");
  });

  it("с верным секретом верит адресу от прокси", () => {
    process.env.PROXY_SECRET = "s3cret";
    const r = req({ "x-forwarded-for": "5.6.7.8", "x-lidomap-proxy": "s3cret", "x-lidomap-client-ip": "9.9.9.9" });
    assert.equal(clientIp(r), "9.9.9.9");
  });

  it("с чужим секретом или без настроенного секрета заголовок прокси игнорирует", () => {
    const spoofed = { "x-forwarded-for": "5.6.7.8", "x-lidomap-proxy": "guess", "x-lidomap-client-ip": "9.9.9.9" };
    assert.equal(clientIp(req(spoofed)), "5.6.7.8");
    process.env.PROXY_SECRET = "s3cret";
    assert.equal(clientIp(req(spoofed)), "5.6.7.8");
  });
});
