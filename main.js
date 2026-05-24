// =========================================
// Main: UI behavior, analysis flow, renders
// Requires: globals.js, prompts.js, exif.js, utils.js
// =========================================

// Mode switcher (uses elements from globals)
document.querySelectorAll(".mode-card").forEach(card => {
    card.addEventListener("click", () => {
        document.querySelectorAll(".mode-card").forEach(c => c.classList.remove("active"));
        card.classList.add("active");
        currentMode = card.dataset.mode;

        analyzeBtnText.textContent = currentMode === "professional"
            ? "开始专业分析"
            : "开始友好点评";

        loadingText.textContent = currentMode === "professional"
            ? "正在分析作品..."
            : "正在发现照片的美好...";
        loadingSub.textContent = currentMode === "professional"
            ? "AI 正在从构图、光线、色彩等维度进行专业评估"
            : "AI 正在为你寻找照片中的闪光点";
    });
});

// Upload handlers
function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) {
        alert("请选择有效的图片文件");
        return;
    }

    selectedFile = file;
    extractedExif = null;

    uploadPlaceholder.classList.add("hidden");
    uploadLoading.classList.remove("hidden");
    previewContainer.classList.add("hidden");

    // 并行提取 EXIF
    extractExif(file).then(exif => {
        extractedExif = formatExif(exif);
        renderExifCard(extractedExif);

    });

    if (file.size > 25 * 1024 * 1024) {
        compressImage(file, 2400, 0.96)
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

// Analyze button
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

    // ✅ 自动保存到本地（验证通过后再存，避免存空值或错误值）
    localStorage.setItem("ai_photo_api_key", apiKey);

    resetAnalysisState();

    analyzeBtn.disabled = true;
    analyzeBtn.style.opacity = "0.6";
    analyzeBtn.style.cursor = "not-allowed";
    const originalBtnText = analyzeBtnText.textContent;
    analyzeBtnText.textContent = "分析中...";

    loadingSection.classList.remove("hidden");
    resultSection.classList.add("hidden");
    document.getElementById("outputPlaceholder").classList.add("hidden");

    const spinner = loadingSection.querySelector('.spinner');
    if (spinner) {
        spinner.style.animation = 'none';
        spinner.offsetHeight;
        spinner.style.animation = '';
    }

    // 隐藏所有条件区域
    document.getElementById("scoreGrid").classList.add("hidden");
    document.getElementById("analysisContainer").classList.add("hidden");
    document.getElementById("encouragementCard").classList.add("hidden");
    document.getElementById("tipsCard").classList.add("hidden");
    document.getElementById("summaryCard").classList.add("hidden");

    startFakeProgress();
    loadingSection.scrollIntoView({ behavior: "smooth", block: "center" });

    const systemPrompt = currentMode === "professional" ? SYSTEM_PROMPT_PRO : SYSTEM_PROMPT_BEGINNER;
    const userPrompt = currentMode === "professional" ? USER_PROMPT_PRO : USER_PROMPT_BEGINNER;

    // EXIF 文本：如果读取到了信息，则附加到 AI 分析提示中
    let exifText = "";
    if (extractedExif && Object.keys(extractedExif).length > 0) {
        exifText = `
以下是从照片中读取到的 EXIF 信息，请据此分析拍摄策略与技术选择：
拍摄时间：${extractedExif.dateTime || "未知"}
光圈：${extractedExif.aperture || "未知"}
快门：${extractedExif.shutterSpeed || "未知"}
ISO：${extractedExif.iso || "未知"}
焦距：${extractedExif.focalLength || "未知"}
机型：${extractedExif.camera || "未知"}
镜头：${extractedExif.lens || "未知"}
`;
    } else {
        exifText = "\n\n（该图片未包含 EXIF 信息，无法读取拍摄参数，请仅基于画面内容进行评价。）";
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        startStageRotation();

        const imageBase64 = await fileToBase64(selectedFile);
        const endpoint = API_ENDPOINTS[provider] || API_ENDPOINTS.moonshot;

        const body = {
            model: modelName,
            temperature: provider === "moonshot" ? 1 : 0.5,
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: [
                        { type: "image_url", image_url: { url: imageBase64 } },
                        { type: "text", text: userPrompt + exifText }
                    ]
                }
            ]
        };

        if (provider === "openai") {
            body.response_format = { type: "json_object" };
        }

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            let errDetail = `HTTP ${response.status}`;
            try {
                const errBody = await response.json();
                errDetail = errBody.error?.message || errBody.error || errDetail;
            } catch (_) { }
            throw new Error(`API 错误：${errDetail}`);
        }

        const data = await response.json();
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
        document.getElementById("outputPlaceholder").classList.remove("hidden");

    } finally {
        clearTimeout(timeoutId);
        stopLoadingAnimation();
        loadingSection.classList.add("hidden");
        analyzeBtn.disabled = false;
        analyzeBtn.style.opacity = "";
        analyzeBtn.style.cursor = "";
        analyzeBtnText.textContent = originalBtnText;
    }
});

function resetAnalysisState() {
    clearInterval(loadingStageInterval);
    clearInterval(loadingProgressInterval);
    loadingStageInterval = null;
    loadingProgressInterval = null;

    const scoreGrid = document.getElementById("scoreGrid");
    const analysisContainer = document.getElementById("analysisContainer");
    const praiseList = document.getElementById("praiseList");
    const tipsList = document.getElementById("tipsList");
    const styleTags = document.getElementById("styleTags");
    const overallScore = document.getElementById("overallScore");
    const photoType = document.getElementById("photoType");
    const overallSummary = document.getElementById("overallSummary");
    const encouragementText = document.getElementById("encouragementText");

    if (scoreGrid) scoreGrid.innerHTML = "";
    if (analysisContainer) analysisContainer.innerHTML = "";
    if (praiseList) praiseList.innerHTML = "";
    if (tipsList) tipsList.innerHTML = "";
    if (styleTags) styleTags.innerHTML = "";
    if (overallScore) overallScore.textContent = "0.0";
    if (photoType) photoType.textContent = "未识别类型";
    if (overallSummary) overallSummary.textContent = "";
    if (encouragementText) encouragementText.textContent = "";

    document.getElementById("summaryCard").classList.add("hidden");
    document.getElementById("scoreGrid").classList.add("hidden");
    document.getElementById("analysisContainer").classList.add("hidden");
    document.getElementById("encouragementCard").classList.add("hidden");
    document.getElementById("tipsCard").classList.add("hidden");
    document.getElementById("praiseCard").classList.add("hidden");
    document.getElementById("outputPlaceholder").classList.remove("hidden");
}

// Render functions
function renderResultProfessional(result) {
    resultSection.classList.remove("hidden");

    // Summary card
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

    // Hide beginner-only section
    document.getElementById("praiseCard").classList.add("hidden");

    // Show professional sections
    document.getElementById("scoreGrid").classList.remove("hidden");
    document.getElementById("analysisContainer").classList.remove("hidden");

    // Score Grid
    const scoreGrid = document.getElementById("scoreGrid");
    scoreGrid.innerHTML = "";

    const scoreOrder = ["composition", "lighting", "color", "storytelling", "overall"];
    const scoreMap = {
        composition: "构图",
        lighting: "光影",
        color: "色彩",
        storytelling: "叙事",
        overall: "综合"
    };

    scoreOrder.forEach(key => {
        const value = result.scores?.[key];
        if (value === undefined || value === null) return;
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
        ["storytelling", "叙事分析", "storytelling"]
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

    setTimeout(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    }, 200);
}

function renderResultBeginner(result) {
    resultSection.classList.remove("hidden");

    // Hide all professional sections
    document.getElementById("summaryCard").classList.add("hidden");
    document.getElementById("scoreGrid").classList.add("hidden");
    document.getElementById("analysisContainer").classList.add("hidden");

    // Show beginner sections
    document.getElementById("encouragementCard").classList.remove("hidden");
    document.getElementById("praiseCard").classList.remove("hidden");
    document.getElementById("tipsCard").classList.remove("hidden");

    // Encouragement
    document.getElementById("encouragementText").textContent = result.overall_summary || "这是一张很有感觉的照片！";

    // Praise: collect some strengths
    const praiseList = document.getElementById("praiseList");
    praiseList.innerHTML = "";

    let allPraise = [];
    ["composition", "lighting", "color", "storytelling"].forEach(key => {
        const section = result[key];
        if (section && section.strengths) {
            section.strengths.forEach(s => allPraise.push(s));
        }
    });
    allPraise = [...new Set(allPraise)].slice(0, 3);
    if (allPraise.length === 0) {
        allPraise = ["画面有清晰的视觉中心", "色彩氛围自然舒适", "整体构图有良好的节奏感"];
    }
    allPraise.forEach((p, i) => {
        const div = document.createElement("div");
        div.className = "tip-item";
        div.innerHTML = `
            <span class="tip-icon">${i + 1}</span>
            <span class="tip-text">${p}</span>
        `;
        praiseList.appendChild(div);
    });

    // Tips: collect all suggestions
    const tipsList = document.getElementById("tipsList");
    tipsList.innerHTML = "";

    let allSuggestions = [];

    ["composition", "lighting", "color", "storytelling"].forEach(key => {
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

    setTimeout(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    }, 200);
}

// Save image (long screenshot)
const saveImageBtn = document.getElementById("saveImageBtn");

saveImageBtn.addEventListener("click", async () => {
    const btnText = saveImageBtn.innerHTML;
    saveImageBtn.innerHTML = `<div class="spinner-small" style="width:16px;height:16px;border-width:2px;margin-right:6px;display:inline-block;vertical-align:middle;"></div>生成中...`;
    saveImageBtn.disabled = true;

    try {
        const isDarkMode = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const exportBg = isDarkMode ? "#0b111d" : "#F5F5F7";
        const exportCardBg = isDarkMode ? "rgba(18, 26, 45, 0.96)" : "#FFFFFF";
        const exportText = isDarkMode ? "#F3F5F9" : "#1D1D1F";
        const exportTextSecondary = isDarkMode ? "#9CA5B4" : "#94949a";
        const exportBorder = isDarkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
        const exportAccentLight = isDarkMode ? "rgba(90,200,255,0.12)" : "rgba(0,122,255,0.08)";
        const exportPraiseBg = isDarkMode ? "linear-gradient(135deg, rgba(18, 26, 44, 0.95) 0%, rgba(22, 32, 52, 0.96) 100%)" : "linear-gradient(135deg, #F2F7FF 0%, #EDF4FF 100%)";
        const exportTipsBg = isDarkMode ? "linear-gradient(135deg, rgba(14, 24, 44, 0.95) 0%, rgba(18, 28, 46, 0.95) 100%)" : "linear-gradient(135deg, #F0F9FF 0%, #E6F4FF 100%)";
        const exportEncourageBg = isDarkMode ? "linear-gradient(135deg, rgba(32, 24, 10, 0.92) 0%, rgba(40, 32, 16, 0.94) 100%)" : "linear-gradient(135deg, #FFF9E6 0%, #FFF5D6 100%)";

        // 1. 离屏容器
        const tempContainer = document.createElement("div");
        tempContainer.style.cssText = `
            position: absolute;
            left: -9999px;
            top: 0;
            width: 800px;
            padding: 40px;
            background: ${exportBg};
            font-family: var(--font-base);
        `;
        document.body.appendChild(tempContainer);

        // 2. 标题头
        const header = document.createElement("div");
        header.innerHTML = `
            <div id="exportHeader" style="text-align: center; margin-bottom: 32px;">
                <h1 style="font-size: 28px; font-weight: 600; color: ${exportText}; margin: 0 0 8px; letter-spacing: -0.02em; font-family: var(--font-heading);">AI 摄影评价</h1>
                <p style="font-size: 14px; color: ${exportTextSecondary}; margin: 0; font-family: var(--font-base);">https://zhayichang.github.io/ai-photo-evaluator</p>
            </div>
        `;
        tempContainer.appendChild(header);

        // 3. 照片
        if (previewImage.src && previewImage.src !== "") {
            const photoWrapper = document.createElement("div");
            photoWrapper.style.cssText = "margin-bottom: 32px; width: 100%;";
            const img = document.createElement("img");
            img.src = previewImage.src;
            img.style.cssText = "width: 100%; height: auto; display: block; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);";
            photoWrapper.appendChild(img);
            tempContainer.appendChild(photoWrapper);
        }

        // 4. 根据当前模式克隆对应卡片
        const contentWrapper = document.createElement("div");
        contentWrapper.style.cssText = "width: 100%; display: flex; flex-direction: column; gap: 20px;";

        if (currentMode === "professional") {
            const ids = ["summaryCard", "scoreGrid", "analysisContainer"];
            ids.forEach(id => {
                const original = document.getElementById(id);
                if (!original) return;
                const clone = original.cloneNode(true);
                clone.classList.remove("hidden");
                clone.style.background = exportCardBg;
                clone.style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)";

                if (id === "summaryCard") {
                    clone.style.borderRadius = "16px";
                    clone.style.padding = "24px";
                    clone.style.display = "flex";
                    clone.style.alignItems = "flex-start";
                    clone.style.justifyContent = "space-between";
                    clone.style.gap = "24px";
                    clone.style.color = exportText;

                    const ring = clone.querySelector("#ringProgress");
                    if (ring) {
                        const circumference = 2 * Math.PI * 60; // ≈ 376.99
                        const score = parseFloat(document.getElementById("overallScore").textContent) || 0;
                        const offset = circumference - (score / 10) * circumference;
                        ring.style.transition = "none";
                        ring.style.strokeDasharray = circumference.toString();
                        ring.style.strokeDashoffset = offset.toString();
                        ring.setAttribute("stroke", "#007AFF");
                    }

                    const ringTrack = clone.querySelector(".ring-track");
                    if (ringTrack) {
                        ringTrack.setAttribute("stroke", isDarkMode ? "rgba(255,255,255,0.08)" : "#F5F5F7");
                    }

                    const ringSvg = clone.querySelector(".ring-svg");
                    if (ringSvg) {
                        ringSvg.style.transform = "rotate(-90deg)";
                        ringSvg.style.transformOrigin = "center center";
                    }
                }

                clone.querySelectorAll(".progress-fill").forEach(bar => {
                    const targetWidth = bar.getAttribute("data-width");
                    if (targetWidth) {
                        bar.style.transition = "none";
                        bar.style.width = targetWidth;
                    }
                });

                contentWrapper.appendChild(clone);
            });
        } else {
            const ids = ["encouragementCard", "praiseCard", "tipsCard"];
            ids.forEach(id => {
                const original = document.getElementById(id);
                if (!original) return;
                const clone = original.cloneNode(true);
                clone.classList.remove("hidden");
                clone.style.background = exportCardBg;
                clone.style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)";
                clone.style.borderRadius = "16px";
                clone.style.padding = "24px";
                contentWrapper.appendChild(clone);
            });
        }

        tempContainer.appendChild(contentWrapper);

        // 5. 等待图片加载
        await Promise.all(
            Array.from(tempContainer.querySelectorAll("img")).map(
                img => new Promise(resolve => {
                    if (img.complete) resolve();
                    else { img.onload = resolve; img.onerror = resolve; }
                })
            )
        );

        // 6. 截图：根据当前主题导出
        const canvas = await html2canvas(tempContainer, {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            backgroundColor: exportBg,
            logging: false,
            onclone: (clonedDoc) => {
                const style = clonedDoc.createElement("style");
                style.textContent = `
                        :root {
                            --bg: ${exportBg} !important;
                            --card: ${exportCardBg} !important;
                            --card-elevated: ${exportCardBg} !important;
                            --text: ${exportText} !important;
                            --text-secondary: ${exportTextSecondary} !important;
                            --border: ${exportBorder} !important;
                            --accent-light: ${exportAccentLight} !important;
                        }
                        body { background-color: ${exportBg} !important; color: ${exportText} !important; }
                        body, div, section, article, aside, header, footer, main, nav, p, h1, h2, h3, h4, h5, h6, span, strong, em, small, label, input, select, button, ul, ol, li {
                            color: ${exportText} !important;
                            background-color: transparent !important;
                        }
                        .card, .score-item, .analysis-card, .tip-item, .praise-list > div, 
                        .encouragement-card, .praise-card, .tips-card, .summary-card,
                        .exif-display-card, .step-item, .mode-card, .upload-placeholder,
                        .title-card, .title-glass, .save-card, .result-section, .score-grid, .analysis-container {
                            background: ${exportCardBg} !important;
                            border-color: ${exportBorder} !important;
                            box-shadow: 0 2px 8px rgba(0,0,0,0.06) !important;
                        }
                        .analysis-card {
                            border-left-width: 4px !important;
                            border-left-style: solid !important;
                        }
                        .analysis-card[data-section="composition"] { border-left-color: #007AFF !important; }
                        .analysis-card[data-section="composition"] .analysis-section li::before { background: #007AFF !important; }
                        .analysis-card[data-section="lighting"] { border-left-color: #FF9500 !important; }
                        .analysis-card[data-section="lighting"] .analysis-section li::before { background: #FF9500 !important; }
                        .analysis-card[data-section="color"] { border-left-color: #FF2D55 !important; }
                        .analysis-card[data-section="color"] .analysis-section li::before { background: #FF2D55 !important; }
                        .analysis-card[data-section="storytelling"] { border-left-color: #AF52DE !important; }
                        .analysis-card[data-section="storytelling"] .analysis-section li::before { background: #AF52DE !important; }
                        .praise-card { background: ${exportPraiseBg} !important; border-color: ${isDarkMode ? 'rgba(90,200,255,0.16)' : 'rgba(0,122,255,0.16)'} !important; }
                        .tips-card { background: ${exportTipsBg} !important; border-color: ${isDarkMode ? 'rgba(90,200,255,0.12)' : 'rgba(0,122,255,0.12)'} !important; }
                        .encouragement-card { background: ${exportEncourageBg} !important; border-color: ${isDarkMode ? 'rgba(255,193,7,0.24)' : 'rgba(255,193,7,0.2)'} !important; }
                        .exif-tag { background: ${isDarkMode ? 'rgba(16,24,40,0.95)' : '#F5F5F7'} !important; border-color: ${exportBorder} !important; }
                        .tag { background: ${isDarkMode ? 'rgba(16,24,40,0.95)' : '#F5F5F7'} !important; color: ${exportText} !important; border-color: ${exportBorder} !important; }
                        .step-item { background: ${exportCardBg} !important; border-color: ${isDarkMode ? 'rgba(90,200,255,0.12)' : 'rgba(0,122,255,0.12)'} !important; }
                        .placeholder-card { background: ${exportCardBg} !important; }
                        .tip-item { background: ${exportCardBg} !important; }
                        .tip-icon { background: #007AFF !important; color: #FFFFFF !important; }
                        #exportHeader h1, #exportHeader p { color: ${exportText} !important; }
                        input, select { background: ${isDarkMode ? 'rgba(12,18,34,0.95)' : '#F5F5F7'} !important; border-color: ${isDarkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)'} !important; color: ${exportText} !important; }
                    `;
                clonedDoc.head.appendChild(style);
            }
        });

        // 7. 下载
        const link = document.createElement("a");
        link.download = `摄影评价_${new Date().toLocaleDateString().replace(/\//g, "-")}.png`;
        link.href = canvas.toDataURL("image/png", 1.0);
        link.click();

        // 8. 清理
        document.body.removeChild(tempContainer);

    } catch (err) {
        console.error("保存图片失败:", err);
        alert("保存图片失败，请重试");
    } finally {
        saveImageBtn.innerHTML = btnText;
        saveImageBtn.disabled = false;
    }
});
