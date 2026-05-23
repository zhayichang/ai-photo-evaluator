const imageInput = document.getElementById("imageInput");
const replaceBtn = document.getElementById("replaceBtn");
const previewImage = document.getElementById("previewImage");
const previewContainer = document.getElementById("previewContainer");
const uploadPlaceholder = document.getElementById("uploadPlaceholder");
const uploadLoading = document.getElementById("uploadLoading");
const analyzeBtn = document.getElementById("analyzeBtn");
const analyzeBtnText = document.getElementById("analyzeBtnText");
const dropZone = document.getElementById("dropZone");
const providerSelect = document.getElementById("provider");
const modelSelect = document.getElementById("modelName");

const loadingSection = document.getElementById("loadingSection");
const loadingText = document.getElementById("loadingText");
const loadingSub = document.getElementById("loadingSub");
const loadingStage = document.getElementById("loadingStage");
const resultSection = document.getElementById("resultSection");

let selectedFile = null;
let currentMode = "beginner";
let loadingStageInterval = null;
let loadingProgressInterval = null;

// =========================================
// 请求超时时间：300 秒（5 分钟）
// =========================================
const REQUEST_TIMEOUT_MS = 300000;

// =========================================
// Prompts
// =========================================

const SYSTEM_PROMPT_PRO = `
你是一名专业摄影评论家与视觉艺术导师。

请对摄影作品进行专业、客观、建设性的结构化分析。

要求：
1. 必须输出合法 JSON
2. 不允许输出 Markdown
3. 不允许输出额外解释
4. 所有评分范围为 0-10
5. 分析必须具体专业
6. 避免空泛夸奖，但不要刻意贬低作品
7. 修改建议必须可执行
8. 评价风格应保持专业、克制、尊重创作者
9. 即使指出不足，也避免尖锐、讽刺、攻击性表达
10. 优先指出作品已经成立的部分，再讨论可优化之处
11. 如果作品属于普通爱好者水平，应以爱好者标准评价，而不是职业比赛标准
12. 应客观分析仍可优化的部分，但不需要刻意寻找缺点
13. 不要对作者意图进行过度推测，除非画面具有明确表达
14. 问题分析应使用“可以进一步优化”“如果调整会更好”等建设性表达

评分参考：
- 5-6 分：普通爱好者水平
- 7 分：完成度较好
- 8 分：优秀作品
- 9 分：专业级作品
- 10 分：极少使用，仅限极高水平作品

请避免评分过低或过于极端。

JSON结构如下：

{
  "photo_type": "",
  "photography_style": [],
  "overall_summary": "",

  "scores": {
    "composition": 0,
    "lighting": 0,
    "color": 0,
    "storytelling": 0,
    "post_processing": 0,
    "visual_impact": 0,
    "originality": 0,
    "overall": 0
  },

  "composition": {
    "analysis": "",
    "strengths": [],
    "improvements": [],
    "suggestions": []
  },

  "lighting": {
    "analysis": "",
    "strengths": [],
    "improvements": [],
    "suggestions": []
  },

  "color": {
    "analysis": "",
    "strengths": [],
    "improvements": [],
    "suggestions": []
  },

  "storytelling": {
    "analysis": "",
    "strengths": [],
    "improvements": [],
    "suggestions": []
  },

  "post_processing": {
    "analysis": "",
    "strengths": [],
    "improvements": [],
    "suggestions": []
  },

  "advanced_analysis": {
    "visual_focus": "",
    "depth_and_layers": "",
    "visual_flow": "",
    "emotional_tone": "",
    "style_reference": [],
    "development_direction": ""
  },

  "final_verdict": ""
}
`;

const SYSTEM_PROMPT_BEGINNER = `
你是一名热情的摄影爱好者导师，擅长用温暖、易懂的语言帮助新手发现照片的美好。

请对摄影作品进行友好、鼓励性的分析。

要求：
1. 必须输出合法 JSON
2. 不允许输出 Markdown
3. 不允许输出额外解释
4. 所有评分范围为 0-10（诚实但稍微宽容）
5. 用通俗语言解释，避免过多专业术语
6. 以鼓励和发现优点为主，建设性建议为辅
7. 修改建议必须简单、对新手友好、可执行
8. overall_summary 用一句温暖、自然的总体评价
9. final_verdict 用一句简短的鼓励结束语

JSON结构如下：

{
  "photo_type": "",
  "photography_style": [],
  "overall_summary": "",

  "scores": {
    "composition": 0,
    "lighting": 0,
    "color": 0,
    "storytelling": 0,
    "post_processing": 0,
    "visual_impact": 0,
    "originality": 0,
    "overall": 0
  },

  "composition": {
    "analysis": "",
    "strengths": [],
    "improvements": [],
    "suggestions": []
  },

  "lighting": {
    "analysis": "",
    "strengths": [],
    "improvements": [],
    "suggestions": []
  },

  "color": {
    "analysis": "",
    "strengths": [],
    "improvements": [],
    "suggestions": []
  },

  "storytelling": {
    "analysis": "",
    "strengths": [],
    "improvements": [],
    "suggestions": []
  },

  "post_processing": {
    "analysis": "",
    "strengths": [],
    "improvements": [],
    "suggestions": []
  },

  "advanced_analysis": {
    "visual_focus": "",
    "depth_and_layers": "",
    "visual_flow": "",
    "emotional_tone": "",
    "style_reference": [],
    "development_direction": ""
  },

  "final_verdict": ""
}
`;

const USER_PROMPT_PRO = `
请对这张摄影作品进行完整专业评价。

重点分析：
- 构图
- 光线
- 色彩
- 情绪
- 叙事
- 后期处理
- 摄影风格
- 专业完成度

请保持客观、建设性的语气。
优先分析作品已经成立的部分，再讨论可优化之处。
避免使用过度否定或攻击性的表达。

总体评价请控制在60字以内，要求精炼。
`;

const USER_PROMPT_BEGINNER = `
请对这张摄影作品进行友好、鼓励性的评价。

请用简单易懂的语言，像朋友一样和拍摄者交流：
- 这张照片最打动人的地方是什么？
- 有哪些值得表扬的优点？
- 给新手一两个简单、好上手的改进建议

避免使用太多专业术语，以鼓励和发现美好为主。
`;

// =========================================
// Provider & Model Switcher
// =========================================

const MODELS = {
    moonshot: [
        { value: "kimi-k2.6", label: "kimi-k2.6" },
        { value: "kimi-k2.5", label: "kimi-k2.5" },
        { value: "moonshot-v1-8k-vision-preview", label: "moonshot-v1-8k-vision" },
        { value: "moonshot-v1-32k-vision-preview", label: "moonshot-v1-32k-vision" },
        { value: "moonshot-v1-128k-vision-preview", label: "moonshot-v1-128k-vision" }
    ],
    openai: [
        { value: "gpt-4o", label: "gpt-4o" },
        { value: "gpt-4o-mini", label: "gpt-4o-mini" }
    ]
};

const API_ENDPOINTS = {
    moonshot: "https://api.moonshot.cn/v1/chat/completions",
    openai: "https://api.openai.com/v1/chat/completions"
};

function populateModels(provider) {
    modelSelect.innerHTML = "";
    const models = MODELS[provider] || MODELS.moonshot;
    models.forEach((m, i) => {
        const opt = document.createElement("option");
        opt.value = m.value;
        opt.textContent = m.label;
        if (i === 0) opt.selected = true;
        modelSelect.appendChild(opt);
    });
}

// Initialize
populateModels("moonshot");

providerSelect.addEventListener("change", () => {
    populateModels(providerSelect.value);
});

// =========================================
// Mode Switcher
// =========================================

document.querySelectorAll(".mode-card").forEach(card => {
    card.addEventListener("click", () => {
        document.querySelectorAll(".mode-card").forEach(c => c.classList.remove("active"));
        card.classList.add("active");
        currentMode = card.dataset.mode;

        // Update button text
        analyzeBtnText.textContent = currentMode === "professional"
            ? "开始专业分析"
            : "开始友好点评";

        // Update loading text
        loadingText.textContent = currentMode === "professional"
            ? "正在分析作品..."
            : "正在发现照片的美好...";
        loadingSub.textContent = currentMode === "professional"
            ? "AI 正在从构图、光线、色彩等维度进行专业评估"
            : "AI 正在为你寻找照片中的闪光点";
    });
});

// =========================================
// Upload & Drag-Drop (with compression)
// =========================================

function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) {
        alert("请选择有效的图片文件");
        return;
    }

    selectedFile = file;

    uploadPlaceholder.classList.add("hidden");
    uploadLoading.classList.remove("hidden");
    previewContainer.classList.add("hidden");

    // 大于 20MB 自动压缩
    if (file.size > 20 * 1024 * 1024) {
        compressImage(file, 2000, 0.92)
            .then(compressedDataUrl => {
                selectedFile = dataUrlToFile(compressedDataUrl, file.name);
                previewImage.src = compressedDataUrl;
                uploadLoading.classList.add("hidden");
                previewContainer.classList.remove("hidden");
            })
            .catch(err => {
                console.error("压缩失败，使用原图", err);
                useOriginalFile(file);
            });
    } else {
        useOriginalFile(file);
    }
}

function useOriginalFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
        previewImage.src = event.target.result;
        uploadLoading.classList.add("hidden");
        previewContainer.classList.remove("hidden");
    };
    reader.onerror = () => {
        uploadLoading.classList.add("hidden");
        uploadPlaceholder.classList.remove("hidden");
        alert("图片读取失败，请重试");
    };
    reader.readAsDataURL(file);
}

// 图片压缩
function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            
            if (width > maxWidth || height > maxWidth) {
                if (width > height) {
                    height = Math.round(height * maxWidth / width);
                    width = maxWidth;
                } else {
                    width = Math.round(width * maxWidth / height);
                    height = maxWidth;
                }
            }
            
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);
            
            const dataUrl = canvas.toDataURL("image/jpeg", quality);
            resolve(dataUrl);
        };
        
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("图片加载失败"));
        };
        
        img.src = url;
    });
}

// DataURL 转 File
function dataUrlToFile(dataUrl, filename) {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
}

replaceBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    imageInput.click();
});

imageInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
});

// Drag & Drop
dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
});

uploadPlaceholder.addEventListener("click", () => imageInput.click());

// =========================================
// Loading Animation
// =========================================

function startFakeProgress() {
    const bar = document.getElementById("loadingProgress");
    bar.style.width = "0%";
    bar.style.transition = "width 0.8s cubic-bezier(0.22, 1, 0.36, 1)";

    // 慢速冲到 15%
    setTimeout(() => bar.style.width = "15%", 300);

    // 然后每 8 秒极缓慢推进，到 90% 停住（适配2-3分钟分析时间）
    let progress = 15;
    loadingProgressInterval = setInterval(() => {
        if (progress < 90) {
            progress += Math.random() * 5 + 2; // 每次 +2~7%
            if (progress > 90) progress = 90;
            bar.style.width = progress + "%";
        }
    }, 8000);
}

function startStageRotation() {
    const stages = currentMode === "professional"
        ? ["正在识别照片类型...", "正在分析构图...", "正在评估光影...", "正在整理色彩...", "正在感受情绪与叙事...", "正在生成专业评价..."]
        : ["正在认识这张照片...", "正在寻找闪光点...", "正在感受照片的情绪...", "正在整理小建议...", "正在为你写寄语..."];

    let i = 0;
    loadingStage.textContent = stages[0];

    loadingStageInterval = setInterval(() => {
        i = (i + 1) % stages.length;
        loadingStage.style.opacity = 0;
        setTimeout(() => {
            loadingStage.textContent = stages[i];
            loadingStage.style.opacity = 1;
        }, 300);
    }, 8000);
}

function stopLoadingAnimation() {
    clearInterval(loadingStageInterval);
    clearInterval(loadingProgressInterval);

    const bar = document.getElementById("loadingProgress");
    bar.style.transition = "width 0.3s ease";
    bar.style.width = "100%";

    setTimeout(() => {
        bar.style.width = "0%";
    }, 500);
}

// =========================================
// Analyze (direct API call with user key)
// =========================================

analyzeBtn.addEventListener("click", async () => {
    const apiKey = document.getElementById("apiKey").value.trim();
    const modelName = document.getElementById("modelName").value.trim();
    const provider = providerSelect.value;

    if (!apiKey) {
        alert("请输入 API Key");
        document.getElementById("apiKey").focus();
        return;
    }
    if (!selectedFile) {
        alert("请先上传图片");
        return;
    }

    // 显示 Loading，隐藏旧结果
    loadingSection.classList.remove("hidden");
    resultSection.classList.add("hidden");

    // 强制重绘 spinner
    const spinner = loadingSection.querySelector('.spinner');
    if (spinner) {
        spinner.style.animation = 'none';
        spinner.offsetHeight;
        spinner.style.animation = '';
    }

    // 隐藏所有条件区域
    document.getElementById("scoreGrid").classList.add("hidden");
    document.getElementById("analysisContainer").classList.add("hidden");
    document.getElementById("advancedCard").classList.add("hidden");
    document.getElementById("encouragementCard").classList.add("hidden");
    document.getElementById("tipsCard").classList.add("hidden");
    document.getElementById("summaryCard").classList.add("hidden");
    document.getElementById("finalCard").classList.add("hidden");

    startFakeProgress();
    loadingSection.scrollIntoView({ behavior: "smooth", block: "center" });

    const systemPrompt = currentMode === "professional" ? SYSTEM_PROMPT_PRO : SYSTEM_PROMPT_BEGINNER;
    const userPrompt = currentMode === "professional" ? USER_PROMPT_PRO : USER_PROMPT_BEGINNER;

    // 创建超时控制器
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        startStageRotation();

        const imageBase64 = await fileToBase64(selectedFile);
        const endpoint = API_ENDPOINTS[provider] || API_ENDPOINTS.moonshot;

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelName,
                temperature: 1,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: systemPrompt },
                    {
                        role: "user",
                        content: [
                            { type: "image_url", image_url: { url: imageBase64 } },
                            { type: "text", text: userPrompt }
                        ]
                    }
                ]
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            let errDetail = `HTTP ${response.status}`;
            try {
                const errBody = await response.json();
                errDetail = errBody.error?.message || errBody.error || errDetail;
            } catch (_) { /* 忽略非 JSON 错误响应 */ }
            throw new Error(`API 错误：${errDetail}`);
        }

        const data = await response.json();

        // 解析 AI 返回的 JSON
        const rawContent = data.choices?.[0]?.message?.content;
        if (!rawContent) {
            throw new Error("AI 返回内容为空");
        }

        let result;
        try {
            result = JSON.parse(rawContent);
        } catch (parseErr) {
            console.error("JSON 解析失败，原始内容：", rawContent);
            throw new Error("AI 返回格式异常，无法解析为 JSON");
        }

        // 渲染结果
        if (currentMode === "professional") {
            renderResultProfessional(result);
        } else {
            renderResultBeginner(result);
        }

    } catch (error) {
        clearTimeout(timeoutId);

        let userMsg = "分析失败";

        if (error.name === 'AbortError') {
            userMsg = "⏱ 分析超时（超过 5 分钟）\n\n可能原因：\n1. 网络连接不稳定\n2. AI 服务繁忙\n3. 图片过大\n\n建议：\n• 换一张较小的图片（建议 < 5MB）\n• 检查网络后重试\n• 稍后再试";
        } else if (error.message.includes('JSON') || error.message.includes('格式异常')) {
            userMsg = "📄 AI 返回格式异常\n\n可能原因：\n1. 当前模型不支持 JSON 强制输出\n2. AI 输出被截断\n3. 模型返回了额外说明文字\n\n建议：\n• 换一个模型（如 kimi-k2.5 / gpt-4o）\n• 缩短提示词后重试";
        } else if (error.message.includes('API 错误') || error.message.includes('HTTP')) {
            userMsg = `🔌 ${error.message}\n\n常见原因：\n• 401：API Key 无效或已过期\n• 429：请求太频繁或额度用尽\n• 500：AI 服务商内部错误\n\n建议检查 API Key 或稍后重试`;
        } else if (error.message.includes('fetch') || error.message.includes('网络') || error.message.includes('Failed')) {
            userMsg = "🌐 网络连接失败\n\n无法连接到 AI 服务，请检查网络后重试。";
        } else {
            userMsg = `❌ 分析失败：${error.message}`;
        }

        alert(userMsg);
        console.error("完整错误：", error);

    } finally {
        // 三重保险：无论如何都停止 loading
        clearTimeout(timeoutId);
        stopLoadingAnimation();
        loadingSection.classList.add("hidden");
    }
});

// =========================================
// File -> Base64
// =========================================

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
    });
}

// =========================================
// Shared: Ring Animation
// =========================================

function animateRing(score) {
    const circle = document.getElementById("ringProgress");
    const radius = 60;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 10) * circumference;

    circle.style.transition = "none";
    circle.style.strokeDashoffset = circumference;

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            circle.style.transition = "stroke-dashoffset 1.5s cubic-bezier(0.22, 1, 0.36, 1)";
            circle.style.strokeDashoffset = offset;
        });
    });
}

// =========================================
// Professional Render
// =========================================

function renderResultProfessional(result) {
    resultSection.classList.remove("hidden");

    // Show summary card with score ring
    const summaryCard = document.getElementById("summaryCard");
    summaryCard.classList.remove("hidden");

    document.getElementById("photoType").textContent = result.photo_type || "未识别类型";
    document.getElementById("overallSummary").textContent = result.overall_summary || "";

    const styleTags = document.getElementById("styleTags");
    styleTags.innerHTML = "";
    (result.photography_style || []).forEach(style => {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = style;
        styleTags.appendChild(tag);
    });

    const overallScore = result.scores?.overall ?? 0;
    document.getElementById("overallScore").textContent = overallScore.toFixed(1);
    animateRing(overallScore);

    // Show professional sections
    document.getElementById("scoreGrid").classList.remove("hidden");
    document.getElementById("analysisContainer").classList.remove("hidden");
    document.getElementById("advancedCard").classList.remove("hidden");
    document.getElementById("finalCard").classList.remove("hidden");
    document.getElementById("finalTitle").textContent = "最终评价";

    // Score Grid
    const scoreGrid = document.getElementById("scoreGrid");
    scoreGrid.innerHTML = "";

    const scoreMap = {
        composition: "构图",
        lighting: "光影",
        color: "色彩",
        storytelling: "叙事",
        post_processing: "后期",
        visual_impact: "视觉冲击",
        originality: "原创性",
        overall: "综合"
    };

    Object.entries(result.scores || {}).forEach(([key, value]) => {
        const item = document.createElement("div");
        item.className = "score-item";
        item.innerHTML = `
            <div class="score-top">
                <span class="score-label">${scoreMap[key] || key}</span>
                <span class="score-value">${value}</span>
            </div>
            <div class="progress-track">
                <div class="progress-fill" style="width: 0%" data-width="${value * 10}%"></div>
            </div>
        `;
        scoreGrid.appendChild(item);
    });

    requestAnimationFrame(() => {
        setTimeout(() => {
            document.querySelectorAll(".progress-fill").forEach(bar => {
                bar.style.width = bar.getAttribute("data-width");
            });
        }, 100);
    });

    // Analysis Cards
    const analysisContainer = document.getElementById("analysisContainer");
    analysisContainer.innerHTML = "";

    const sections = [
        ["composition", "构图分析", "composition"],
        ["lighting", "光影分析", "lighting"],
        ["color", "色彩分析", "color"],
        ["storytelling", "叙事分析", "storytelling"],
        ["post_processing", "后期分析", "post_processing"]
    ];

    sections.forEach(([key, title, colorKey]) => {
        const sectionData = result[key];
        if (!sectionData) return;

        const card = document.createElement("div");
        card.className = "analysis-card";
        card.setAttribute("data-section", colorKey);

        card.innerHTML = `
            <h2>${title}</h2>
            <p>${sectionData.analysis || ""}</p>
            ${renderListSection("优点", sectionData.strengths)}
            ${renderListSection("可优化点", sectionData.improvements)}
            ${renderListSection("修改建议", sectionData.suggestions)}
        `;
        analysisContainer.appendChild(card);
    });

    // Advanced Analysis
    const advancedGrid = document.getElementById("advancedGrid");
    advancedGrid.innerHTML = "";

    const advanced = result.advanced_analysis || {};
    const advancedMap = {
        visual_focus: "视觉焦点",
        depth_and_layers: "空间层次",
        visual_flow: "视觉流动",
        emotional_tone: "情绪基调",
        style_reference: "风格参考",
        development_direction: "发展方向"
    };

    Object.entries(advancedMap).forEach(([key, title]) => {
        const item = document.createElement("div");
        item.className = "advanced-item";

        let value = advanced[key];
        if (Array.isArray(value)) value = value.join("、");

        item.innerHTML = `
            <h4>${title}</h4>
            <p>${value || "—"}</p>
        `;
        advancedGrid.appendChild(item);
    });

    // Final Verdict
    document.getElementById("finalVerdict").textContent = result.final_verdict || "";

    setTimeout(() => {
        resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
}

// =========================================
// Beginner Render
// =========================================

function renderResultBeginner(result) {
    resultSection.classList.remove("hidden");

    // Hide all professional sections
    document.getElementById("summaryCard").classList.add("hidden");
    document.getElementById("scoreGrid").classList.add("hidden");
    document.getElementById("analysisContainer").classList.add("hidden");
    document.getElementById("advancedCard").classList.add("hidden");

    // Show beginner sections: 只保留暖黄鼓励卡片 + 小建议 + 寄语
    document.getElementById("encouragementCard").classList.remove("hidden");
    document.getElementById("tipsCard").classList.remove("hidden");
    document.getElementById("finalCard").classList.remove("hidden");
    document.getElementById("finalTitle").textContent = "寄语";

    // Encouragement
    document.getElementById("encouragementText").textContent = result.overall_summary || "这是一张很有感觉的照片！";

    // Tips: collect all suggestions
    const tipsList = document.getElementById("tipsList");
    tipsList.innerHTML = "";

    let allSuggestions = [];

    ["composition", "lighting", "color", "storytelling", "post_processing"].forEach(key => {
        const section = result[key];
        if (section && section.suggestions) {
            section.suggestions.forEach(s => allSuggestions.push(s));
        }
    });

    allSuggestions = [...new Set(allSuggestions)].slice(0, 3);

    if (allSuggestions.length === 0) {
        allSuggestions = ["多尝试不同角度拍摄", "留意自然光线的变化"];
    }

    allSuggestions.forEach((tip, i) => {
        const div = document.createElement("div");
        div.className = "tip-item";
        div.innerHTML = `
            <span class="tip-icon">${i + 1}</span>
            <span class="tip-text">${tip}</span>
        `;
        tipsList.appendChild(div);
    });

    // Final Verdict
    document.getElementById("finalVerdict").textContent = result.final_verdict || "继续拍摄，你会越来越棒！";

    setTimeout(() => {
        resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
}

// =========================================
// Render List Helper
// =========================================

function renderListSection(title, items = []) {
    if (!items.length) return "";
    return `
        <div class="analysis-section">
            <h4>${title}</h4>
            <ul>
                ${items.map(item => `<li>${item}</li>`).join("")}
            </ul>
        </div>
    `;
}