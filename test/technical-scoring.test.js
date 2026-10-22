import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTechnical, calculateOverallScore } from "../technical-scoring.js";

test("intentional effects can pass the technical check without a deduction", () => {
    const technical = normalizeTechnical({
        level: "none",
        deduction: 0,
        observation: "有意的运动模糊保留了动作方向",
        impact: "",
        suggestion: ""
    });
    assert.equal(technical.deduction, 0);
    assert.equal(calculateOverallScore(8.2, technical.deduction), 8.2);
});

test("technical deductions are bounded by the reported impact level", () => {
    for (const [level, deduction] of [
        ["slight", 0.5], ["moderate", 0.6], ["severe", 2.0]
    ]) {
        const technical = normalizeTechnical({ level, deduction, observation: "主体模糊", impact: "表情难以辨认" });
        assert.equal(technical.deduction, deduction);
    }
    assert.equal(calculateOverallScore(8.2, 0.5), 7.7);
    assert.equal(calculateOverallScore(0.5, 2.0), 0);
    assert.throws(() => normalizeTechnical({ level: "slight", deduction: 0.6, observation: "主体模糊", impact: "表情难以辨认" }), /格式异常/);
    assert.throws(() => normalizeTechnical({ level: "moderate", deduction: 0.55, observation: "主体模糊", impact: "表情难以辨认" }), /格式异常/);
    assert.throws(() => normalizeTechnical({ level: "slight", deduction: 0.3, observation: "主体模糊" }), /格式异常/);
    assert.throws(() => normalizeTechnical({ level: "none", deduction: 0, observation: "" }), /格式异常/);
});
