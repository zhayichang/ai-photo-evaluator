import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonWithBareQuoteRepair } from "../json-repair.js";

test("parses valid JSON without changing it", () => {
    const result = parseJsonWithBareQuoteRepair('{"summary":"正常内容"}');

    assert.equal(result.repaired, false);
    assert.equal(result.value.summary, "正常内容");
});

test("repairs unescaped quotation marks inside JSON strings", () => {
    const malformed = `{
        "improvements": ["中间调偏灰，画面略显"闷""],
        "analysis": "这是一幅典型的"正在发生的餐桌"图景，叙事停留在"记录"层面。",
        "tone": "带有年轻人聚餐时"先拍后吃"的即兴感。"
    }`;
    const result = parseJsonWithBareQuoteRepair(malformed);

    assert.equal(result.repaired, true);
    assert.deepEqual(result.value.improvements, ['中间调偏灰，画面略显"闷"']);
    assert.match(result.value.analysis, /"正在发生的餐桌"/);
    assert.match(result.value.analysis, /"记录"/);
    assert.match(result.value.tone, /"先拍后吃"/);
});

test("does not hide unrelated JSON syntax errors", () => {
    assert.throws(() => parseJsonWithBareQuoteRepair('{"summary": invalid}'));
});
