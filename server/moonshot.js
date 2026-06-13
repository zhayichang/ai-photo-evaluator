const MOONSHOT_ENDPOINT = "https://api.moonshot.cn/v1/chat/completions";

async function callModel({ model, image, systemPrompt, userPrompt, apiKey, timeoutMs }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(MOONSHOT_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                temperature: 1,
                messages: [
                    { role: "system", content: systemPrompt },
                    {
                        role: "user",
                        content: [
                            { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.buffer.toString("base64")}` } },
                            { type: "text", text: userPrompt }
                        ]
                    }
                ]
            }),
            signal: controller.signal
        });
        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            const error = new Error(errorBody.error?.message || `Moonshot HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        }
        const data = await response.json();
        const rawContent = data.choices?.[0]?.message?.content;
        if (!rawContent) throw new Error("Moonshot 返回内容为空");
        return rawContent;
    } finally {
        clearTimeout(timeout);
    }
}

export async function analyzeWithMoonshot({ image, systemPrompt, userPrompt, env = process.env }) {
    if (!env.MOONSHOT_API_KEY) throw new Error("服务端未配置 MOONSHOT_API_KEY");
    const models = [
        env.MOONSHOT_PRIMARY_MODEL || "kimi-k2.6",
        env.MOONSHOT_FALLBACK_MODEL || "kimi-k2.5"
    ].filter((model, index, list) => model && list.indexOf(model) === index);
    const deadline = Date.now() + Number(env.MOONSHOT_TOTAL_TIMEOUT_MS || 300000);
    let lastError;

    for (let index = 0; index < models.length; index++) {
        const remaining = deadline - Date.now();
        if (remaining < 5000) break;
        const timeoutMs = index === 0 ? Math.min(180000, remaining) : remaining;
        try {
            const rawContent = await callModel({
                model: models[index],
                image,
                systemPrompt,
                userPrompt,
                apiKey: env.MOONSHOT_API_KEY,
                timeoutMs
            });
            return { rawContent, model: models[index] };
        } catch (error) {
            lastError = error;
            if ([400, 401, 403, 429].includes(error.status)) break;
        }
    }
    const error = new Error(lastError?.name === "AbortError" ? "AI 分析超时" : "AI 服务暂时不可用");
    error.code = lastError?.name === "AbortError" ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR";
    error.status = lastError?.status === 429 ? 429 : 502;
    throw error;
}
