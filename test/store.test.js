import test from "node:test";
import assert from "node:assert/strict";
import { createStore, enforceRateLimits } from "../server/store.js";

test("development memory store supports deduplication", async () => {
    const store = createStore({ NODE_ENV: "test" });
    assert.equal(await store.set("lock", { active: true }, 60, true), true);
    assert.equal(await store.set("lock", { active: true }, 60, true), false);
    assert.deepEqual(await store.get("lock"), { active: true });
});

test("rate limiter rejects the fourth hourly request by default", async () => {
    const store = createStore({ NODE_ENV: "test" });
    const env = {
        RATE_LIMIT_IP_HOURLY: "3",
        RATE_LIMIT_IP_DAILY: "10",
        RATE_LIMIT_GLOBAL_DAILY: "100"
    };
    await enforceRateLimits(store, "203.0.113.10", env);
    await enforceRateLimits(store, "203.0.113.10", env);
    await enforceRateLimits(store, "203.0.113.10", env);
    await assert.rejects(
        enforceRateLimits(store, "203.0.113.10", env),
        (error) => error.code === "RATE_LIMITED" && error.status === 429
    );
});

test("production refuses to run without Redis", () => {
    assert.throws(
        () => createStore({ NODE_ENV: "production" }),
        /必须配置 REDIS_URL/
    );
});
