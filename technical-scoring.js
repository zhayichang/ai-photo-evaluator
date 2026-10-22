export function normalizeTechnical(technical) {
    const bounds = {
        none: [0, 0],
        slight: [0.1, 0.5],
        moderate: [0.6, 1.0],
        severe: [1.1, 2.0],
        uncertain: [0, 0]
    };
    const level = technical?.level;
    const deduction = technical?.deduction;
    const range = bounds[level];
    if (!range || typeof deduction !== "number" || !Number.isFinite(deduction)
        || deduction < range[0] || deduction > range[1]
        || Math.abs(deduction * 10 - Math.round(deduction * 10)) > 1e-8) {
        throw new Error("技术完成度格式异常：扣分与影响等级不符");
    }
    const observation = typeof technical.observation === "string" ? technical.observation.trim() : "";
    const impact = typeof technical.impact === "string" ? technical.impact.trim() : "";
    if (!observation || (deduction > 0 && !impact)) {
        throw new Error("技术完成度格式异常：缺少画面依据或扣分影响");
    }
    return {
        level,
        deduction,
        observation,
        impact,
        suggestion: typeof technical.suggestion === "string" ? technical.suggestion.trim() : ""
    };
}

export function calculateOverallScore(overallBase, technicalDeduction) {
    return Math.max(0, Math.round((overallBase - technicalDeduction) * 10) / 10);
}
