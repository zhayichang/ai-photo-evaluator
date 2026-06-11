import test from "node:test";
import assert from "node:assert/strict";
import { analyzeWithMoonshot } from "../server/moonshot.js";

test("uses at most one fallback model", async (context) => {
    const originalFetch = globalThis.fetch;
    const models = [];
    context.after(() => {
        globalThis.fetch = originalFetch;
    });
    globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        models.push(body.model);
        if (models.length === 1) return new Response("{}", { status: 500 });
        return Response.json({ choices: [{ message: { content: "{\"photo_type\":\"测试\"}" } }] });
    };

    const result = await analyzeWithMoonshot({
        image: { mime: "image/png", buffer: Buffer.from("image") },
        systemPrompt: "system",
        userPrompt: "user",
        env: {
            MOONSHOT_API_KEY: "test-only-key",
            MOONSHOT_PRIMARY_MODEL: "primary",
            MOONSHOT_FALLBACK_MODEL: "fallback",
            MOONSHOT_TOTAL_TIMEOUT_MS: "20000"
        }
    });
    assert.deepEqual(models, ["primary", "fallback"]);
    assert.equal(result.model, "fallback");
});

test("does not retry authentication failures", async (context) => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    context.after(() => {
        globalThis.fetch = originalFetch;
    });
    globalThis.fetch = async () => {
        calls += 1;
        return Response.json({ error: { message: "unauthorized" } }, { status: 401 });
    };

    await assert.rejects(analyzeWithMoonshot({
        image: { mime: "image/png", buffer: Buffer.from("image") },
        systemPrompt: "system",
        userPrompt: "user",
        env: {
            MOONSHOT_API_KEY: "test-only-key",
            MOONSHOT_PRIMARY_MODEL: "primary",
            MOONSHOT_FALLBACK_MODEL: "fallback",
            MOONSHOT_TOTAL_TIMEOUT_MS: "5000"
        }
    }));
    assert.equal(calls, 1);
});
