const imageInput = document.getElementById("imageInput");
const uploadBtn = document.getElementById("uploadBtn");
const previewImage = document.getElementById("previewImage");
const analyzeBtn = document.getElementById("analyzeBtn");

const loadingSection = document.getElementById("loadingSection");
const resultSection = document.getElementById("resultSection");

let selectedFile = null;

// =========================================
// System Prompt
// =========================================

const SYSTEM_PROMPT = `
你是一名专业摄影评论家与视觉艺术导师。

请对摄影作品进行专业、严格、结构化分析。

要求：
1. 必须输出合法 JSON
2. 不允许输出 Markdown
3. 不允许输出额外解释
4. 所有评分范围为 0-10
5. 分析必须具体专业
6. 不要空泛夸奖
7. 修改建议必须可执行

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
    "problems": [],
    "suggestions": []
  },

  "lighting": {
    "analysis": "",
    "strengths": [],
    "problems": [],
    "suggestions": []
  },

  "color": {
    "analysis": "",
    "strengths": [],
    "problems": [],
    "suggestions": []
  },

  "storytelling": {
    "analysis": "",
    "strengths": [],
    "problems": [],
    "suggestions": []
  },

  "post_processing": {
    "analysis": "",
    "strengths": [],
    "problems": [],
    "suggestions": []
  },

  "advanced_analysis": {
    "visual_focus": "",
    "depth_and_layers": "",
    "visual_flow": "",
    "emotional_tone": "",
    "style_reference": [],
    "professional_potential": ""
  },

  "final_verdict": ""
}
`;

const USER_PROMPT = `
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

必须指出问题。
`;

// =========================================
// Upload Image
// =========================================

uploadBtn.addEventListener("click", () => {
    imageInput.click();
});

imageInput.addEventListener("change", (e) => {

    const file = e.target.files[0];

    if (!file) return;

    selectedFile = file;

    const reader = new FileReader();

    reader.onload = (event) => {
        previewImage.src = event.target.result;
        previewImage.style.display = "block";
    };

    reader.readAsDataURL(file);
});

// =========================================
// Analyze
// =========================================

analyzeBtn.addEventListener("click", async () => {

    const apiKey = document.getElementById("apiKey").value.trim();
    const modelName = document.getElementById("modelName").value.trim();

    if (!apiKey) {
        alert("请输入 API Key");
        return;
    }

    if (!selectedFile) {
        alert("请先上传图片");
        return;
    }

    loadingSection.classList.remove("hidden");
    resultSection.classList.add("hidden");

    try {

        const imageBase64 = await fileToBase64(selectedFile);

        const response = await fetch(
            "https://api.moonshot.cn/v1/chat/completions",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: modelName,
                    temperature: 1,

                    response_format: {
                        type: "json_object"
                    },

                    messages: [
                        {
                            role: "system",
                            content: SYSTEM_PROMPT
                        },
                        {
                            role: "user",
                            content: [
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: imageBase64
                                    }
                                },
                                {
                                    type: "text",
                                    text: USER_PROMPT
                                }
                            ]
                        }
                    ]
                })
            }
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        const rawContent = data.choices[0].message.content;

        const result = JSON.parse(rawContent);

        renderResult(result);

    } catch (error) {

        console.error(error);

        alert(
            "分析失败。\n\n可能原因：\n1. API Key 无效\n2. 网络错误\n3. Moonshot API 不支持浏览器跨域\n4. 返回 JSON 格式异常"
        );

    } finally {

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
// Render Result
// =========================================

function renderResult(result) {

    resultSection.classList.remove("hidden");

    // ----------------------
    // Summary
    // ----------------------

    document.getElementById("photoType").textContent =
        result.photo_type || "未识别类型";

    document.getElementById("overallSummary").textContent =
        result.overall_summary || "";

    document.getElementById("overallScore").textContent =
        result.scores.overall;

    // ----------------------
    // Style Tags
    // ----------------------

    const styleTags = document.getElementById("styleTags");

    styleTags.innerHTML = "";

    (result.photography_style || []).forEach(style => {

        const tag = document.createElement("div");

        tag.className = "tag";

        tag.textContent = style;

        styleTags.appendChild(tag);
    });

    // ----------------------
    // Score Grid
    // ----------------------

    const scoreGrid = document.getElementById("scoreGrid");

    scoreGrid.innerHTML = "";

    const scoreMap = {
        composition: "构图",
        lighting: "光线",
        color: "色彩",
        storytelling: "叙事",
        post_processing: "后期",
        visual_impact: "视觉冲击",
        originality: "原创性",
        overall: "综合"
    };

    Object.entries(result.scores).forEach(([key, value]) => {

        const item = document.createElement("div");

        item.className = "score-item";

        item.innerHTML = `
            <div class="score-top">
                <span>${scoreMap[key] || key}</span>
                <strong>${value}</strong>
            </div>

            <div class="progress">
                <div
                    class="progress-fill"
                    style="width:${value * 10}%"
                ></div>
            </div>
        `;

        scoreGrid.appendChild(item);
    });

    // ----------------------
    // Analysis Cards
    // ----------------------

    const analysisContainer = document.getElementById(
        "analysisContainer"
    );

    analysisContainer.innerHTML = "";

    const sections = [
        ["composition", "构图分析"],
        ["lighting", "光线分析"],
        ["color", "色彩分析"],
        ["storytelling", "叙事分析"],
        ["post_processing", "后期分析"]
    ];

    sections.forEach(([key, title]) => {

        const sectionData = result[key];

        if (!sectionData) return;

        const card = document.createElement("div");

        card.className = "analysis-card";

        card.innerHTML = `
            <h2>${title}</h2>

            <p>${sectionData.analysis || ""}</p>

            ${renderListSection("优点", sectionData.strengths)}
            ${renderListSection("问题", sectionData.problems)}
            ${renderListSection("修改建议", sectionData.suggestions)}
        `;

        analysisContainer.appendChild(card);
    });

    // ----------------------
    // Advanced Analysis
    // ----------------------

    const advancedGrid = document.getElementById("advancedGrid");

    advancedGrid.innerHTML = "";

    const advanced = result.advanced_analysis || {};

    const advancedMap = {
        visual_focus: "视觉焦点",
        depth_and_layers: "空间层次",
        visual_flow: "视觉流动",
        emotional_tone: "情绪基调",
        style_reference: "风格参考",
        professional_potential: "专业潜力"
    };

    Object.entries(advancedMap).forEach(([key, title]) => {

        const item = document.createElement("div");

        item.className = "advanced-item";

        let value = advanced[key];

        if (Array.isArray(value)) {
            value = value.join("、");
        }

        item.innerHTML = `
            <h4>${title}</h4>
            <p>${value || ""}</p>
        `;

        advancedGrid.appendChild(item);
    });

    // ----------------------
    // Final Verdict
    // ----------------------

    document.getElementById("finalVerdict").textContent =
        result.final_verdict || "";

    // ----------------------
    // Scroll
    // ----------------------

    resultSection.scrollIntoView({
        behavior: "smooth"
    });
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