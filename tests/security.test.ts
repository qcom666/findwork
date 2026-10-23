import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { csvCell } from "../src/lib/format";
import { jsonLd } from "../src/lib/jsonld";
import { safeNext } from "../src/lib/nav";

describe("защита от подмены и внедрения", () => {
  it("возврат после входа только на свои страницы", () => {
    for (const ok of ["/", "/leads?city=Тула", "/lead/abc"]) assert.equal(safeNext(ok), ok);
    for (const bad of ["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "/ /evil.com", "https://evil.com", "evil.com", "/%0a", "/" + "a".repeat(600)]) {
      assert.equal(safeNext(bad), bad === "/%0a" ? "/%0a" : "/", JSON.stringify(bad));
    }
    assert.equal(safeNext(undefined), "/");
    assert.equal(safeNext(["//evil.com", "/ok"]), "/");
  });

  it("CSV не даёт Excel выполнить формулу из названия заведения", () => {
    assert.equal(csvCell("=HYPERLINK(\"http://x\")"), "\"'=HYPERLINK(\"\"http://x\"\")\"");
    assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(csvCell("+79001234567"), "'+79001234567");
    assert.equal(csvCell("-1"), "'-1");
    assert.equal(csvCell("Кафе «Лотос»"), "Кафе «Лотос»");
    assert.equal(csvCell(42), "42");
  });

  it("JSON-LD нельзя закрыть тегом </script> из данных", () => {
    const out = jsonLd({ name: "</script><script>alert(1)</script>", amp: "a&b" });
    assert.ok(!out.includes("<") && !out.includes(">") && !out.includes("&"));
    assert.deepEqual(JSON.parse(out), { name: "</script><script>alert(1)</script>", amp: "a&b" });
  });
});
