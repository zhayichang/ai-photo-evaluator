import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompts } from "../server/prompts.js";

test("prompts explain that the analyzed image is a compressed preview", () => {
    for (const mode of ["beginner", "professional"]) {
        const { systemPrompt } = buildPrompts(mode, {});
        assert.match(systemPrompt, /网络传输/);
        assert.match(systemPrompt, /不是原始文件/);
        assert.match(systemPrompt, /压缩/);
    }
});
