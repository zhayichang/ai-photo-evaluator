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

test("technical assessment and deductions belong only to professional mode", () => {
    const professional = buildPrompts("professional", {}).systemPrompt;
    const beginner = buildPrompts("beginner", {}).systemPrompt;
    assert.match(professional, /technical\.deduction/);
    assert.match(professional, /不要在其中预先扣除/);
    assert.match(professional, /有意的模糊、暗调或颗粒感/);
    assert.match(professional, /"technical"/);
    assert.doesNotMatch(beginner, /technical|技术扣分|"technical"/);
});
