import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../config.js", import.meta.url), "utf8");

test("local previews never point image analysis at the online API", () => {
    for (const hostname of ["localhost", "127.0.0.1"]) {
        const window = { location: { hostname, protocol: "http:" } };
        runInNewContext(source, { window });
        assert.equal(window.APP_CONFIG.apiEndpoint, "http://127.0.0.1:9000/api/analyze");
    }
});

test("deployed page keeps its configured analysis endpoint", () => {
    const window = { location: { hostname: "zhayichang.github.io", protocol: "https:" } };
    runInNewContext(source, { window });
    assert.equal(window.APP_CONFIG.apiEndpoint, "https://photo-eator-api-htmyliwsyn.cn-hangzhou.fcapp.run/api/analyze");
});
