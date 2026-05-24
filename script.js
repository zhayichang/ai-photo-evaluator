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
let extractedExif = null;
let isAnalyzing = false;

// =========================================
// 请求超时时间：300 秒（5 分钟）
// =========================================
const REQUEST_TIMEOUT_MS = 300000;

// =========================================
// 自动回填保存的 API Key
// =========================================
const savedApiKey = localStorage.getItem("ai_photo_api_key");
if (savedApiKey) {
    document.getElementById("apiKey").value = savedApiKey;
}

// =========================================
// EXIF 提取器（轻量 JPEG 解析，纯本地）
// =========================================

function extractExif(file) {
    return new Promise((resolve) => {
        if (!file.type.startsWith("image/jpeg")) {
            resolve(null);
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            const exif = parseExif(data);
            resolve(exif);
        };
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(file);
    });
}

function parseExif(data) {
    let offset = 0;
    if (data[0] !== 0xFF || data[1] !== 0xD8) return null;
    offset = 2;
    while (offset < data.length) {
        if (data[offset] !== 0xFF) return null;
        const marker = data[offset + 1];
        if (marker === 0xE1) {
            const length = (data[offset + 2] << 8) | data[offset + 3];
            const exifData = data.slice(offset + 4, offset + 2 + length);
            if (exifData[0] === 0x45 && exifData[1] === 0x78 && exifData[2] === 0x69 && exifData[3] === 0x66) {
                return parseExifIFD(exifData.slice(6));
            }
            return null;
        }
        if (marker === 0xD9) return null;
        if (marker === 0xD8 || marker === 0xD9) return null;
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
            offset += 2;
            continue;
        }
        const length = (data[offset + 2] << 8) | data[offset + 3];
        offset += 2 + length;
    }
    return null;
}

function parseExifIFD(data) {
    const tiff = data;
    let littleEndian = true;
    if (tiff[0] === 0x49 && tiff[1] === 0x49) littleEndian = true;
    else if (tiff[0] === 0x4D && tiff[1] === 0x4D) littleEndian = false;
    else return null;

    const ifdOffset = readUint32(tiff, 4, littleEndian);
    return readIFD(tiff, ifdOffset, littleEndian);
}

function readIFD(tiff, offset, littleEndian) {
    const numEntries = readUint16(tiff, offset, littleEndian);
    const result = {};
    offset += 2;
    for (let i = 0; i < numEntries; i++) {
        const tag = readUint16(tiff, offset, littleEndian);
        const type = readUint16(tiff, offset + 2, littleEndian);
        const count = readUint32(tiff, offset + 4, littleEndian);
        const valueOffset = readUint32(tiff, offset + 8, littleEndian);
        const value = readValue(tiff, tag, type, count, valueOffset, littleEndian, offset + 8);

        // Exif 子 IFD 与 GPS IFD 指针
        if ((tag === 0x8769 || tag === 0x8825) && type === 4 && count === 1 && valueOffset > 0) {
            const subExif = readIFD(tiff, valueOffset, littleEndian);
            Object.assign(result, subExif);
        }

        if (value !== null) {
            const key = getExifTagName(tag);
            if (key) result[key] = value;
        }
        offset += 12;
    }
    return result;
}

function readUint16(data, offset, littleEndian) {
    if (littleEndian) return data[offset] | (data[offset + 1] << 8);
    return (data[offset] << 8) | data[offset + 1];
}

function readUint32(data, offset, littleEndian) {
    if (littleEndian) {
        return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
    }
    return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
}

function readValue(data, tag, type, count, valueOffset, littleEndian, inlineOffset) {
    const sizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
    const size = sizes[type] || 0;
    const totalSize = size * count;
    const offset = totalSize <= 4 ? inlineOffset : valueOffset;

    if (type === 2) {
        let str = "";
        for (let i = 0; i < count - 1; i++) {
            str += String.fromCharCode(data[offset + i]);
        }
        return str.trim();
    }
    if (type === 3) {
        if (count === 1) return readUint16(data, offset, littleEndian);
        const arr = [];
        for (let i = 0; i < count; i++) {
            arr.push(readUint16(data, offset + i * 2, littleEndian));
        }
        return arr;
    }
    if (type === 5) {
        const num = readUint32(data, offset, littleEndian);
        const den = readUint32(data, offset + 4, littleEndian);
        if (den === 0) return null;
        return num / den;
    }
    if (type === 10) {
        const num = readInt32(data, offset, littleEndian);
        const den = readInt32(data, offset + 4, littleEndian);
        if (den === 0) return null;
        return num / den;
    }
    if (type === 1 || type === 7) {
        if (count === 1) return data[offset];
        const arr = [];
        for (let i = 0; i < count; i++) arr.push(data[offset + i]);
        return arr;
    }
    return null;
}

function readInt32(data, offset, littleEndian) {
    const val = readUint32(data, offset, littleEndian);
    return val > 0x7FFFFFFF ? val - 0x100000000 : val;
}

function getExifTagName(tag) {
    const map = {
        0x010F: "camera",
        0x0110: "cameraModel",
        0x0112: "orientation",
        0x0100: "imageWidth",
        0x0101: "imageHeight",
        0x0132: "dateTime",
        0x9003: "dateTimeOriginal",
        0x9004: "dateTimeDigitized",
        0x829A: "exposureTime",
        0x829D: "fNumber",
        0x8827: "iso",
        0x9202: "apertureValue",
        0x9201: "shutterSpeedValue",
        0x920A: "focalLength",
        0xA433: "lensMake",
        0xA434: "lensModel",
        0x8822: "exposureProgram",
        0x9207: "meteringMode",
        0x9209: "flash",
        0xA406: "sceneCaptureType",
        0xA405: "focalLengthIn35mmFilm",
        0xA402: "recommendedExposureIndex",
        0xA403: "sensingMethod",
        0xA430: "cameraOwnerName",
        0x0131: "software",
        0x9000: "exifVersion",
        0x9204: "spectralSensitivity",
        0xA000: "flashpixVersion",
        0xA001: "colorSpace",
        0xA002: "pixelXDimension",
        0xA003: "pixelYDimension",
        0xA420: "imageUniqueID",
        0x8825: "gpsInfo",
        0x0000: "gpsVersion",
        0x0001: "gpsLatitudeRef",
        0x0002: "gpsLatitude",
        0x0003: "gpsLongitudeRef",
        0x0004: "gpsLongitude",
        0x0005: "gpsAltitudeRef",
        0x0006: "gpsAltitude",
        0x001D: "gpsDateStamp"
    };
    return map[tag] || null;
}

function formatExif(exif) {
    if (!exif) return null;
    const fmt = {};
    if (exif.camera) fmt.camera = exif.camera;
    if (exif.cameraModel) fmt.camera = (fmt.camera ? fmt.camera + " " : "") + exif.cameraModel;
    if (exif.lensMake || exif.lensModel) {
        fmt.lens = (exif.lensMake || "") + " " + (exif.lensModel || "");
        fmt.lens = fmt.lens.trim() || "未知";
    }
    if (exif.fNumber) {
        fmt.aperture = "f/" + Number(exif.fNumber).toFixed(1);
    } else if (exif.apertureValue) {
        const f = Math.pow(2, exif.apertureValue / 2);
        fmt.aperture = "f/" + f.toFixed(1);
    }
    if (exif.exposureTime) {
        fmt.shutterSpeed = typeof exif.exposureTime === "number"
            ? (exif.exposureTime < 1 ? "1/" + Math.round(1 / exif.exposureTime) + "s" : exif.exposureTime.toFixed(1) + "s")
            : exif.exposureTime;
    } else if (exif.shutterSpeedValue) {
        const s = Math.pow(2, -exif.shutterSpeedValue);
        fmt.shutterSpeed = s < 1 ? "1/" + Math.round(1 / s) + "s" : s.toFixed(1) + "s";
    }
    if (exif.iso) fmt.iso = "ISO " + exif.iso;
    if (exif.focalLength) fmt.focalLength = exif.focalLength + "mm";
    if (exif.focalLengthIn35mmFilm) fmt.focalLength35 = exif.focalLengthIn35mmFilm + "mm (35mm 等效)";
    if (exif.imageWidth && exif.imageHeight) fmt.resolution = exif.imageWidth + " × " + exif.imageHeight;
    if (exif.dateTimeOriginal) fmt.dateTime = normalizeExifDateTime(exif.dateTimeOriginal);
    else if (exif.dateTime) fmt.dateTime = normalizeExifDateTime(exif.dateTime);
    if (exif.exposureProgram) {
        const programs = {
            0: "拍摄模式未定义",
            1: "手动模式",
            2: "普通模式",
            3: "光圈优先",
            4: "快门优先",
            5: "创意程序",
            6: "动作模式",
            7: "全景模式"
        };
        fmt.exposureProgram = programs[exif.exposureProgram] || "未知";
    }
    if (exif.meteringMode) {
        const modes = {
            0: "未知测光模式",
            1: "平均测光",
            2: "中央重点测光",
            3: "点测光",
            4: "局部测光",
            5: "多点测光",
            6: "场景测光",
            255: "其他测光模式"
        };
        fmt.metering = modes[exif.meteringMode] || "未知";
    }
    if (exif.flash !== undefined) {
        const flash = Number(exif.flash);
        const fired = (flash & 1) !== 0;
        fmt.flash = fired ? "闪光灯已触发" : "闪光灯未触发";
    }
    if (exif.whiteBalance !== undefined) {
        fmt.whiteBalance = exif.whiteBalance === 1 ? "手动白平衡" : "自动白平衡";
    }
    if (exif.orientation) {
        const orientations = {
            1: "正常",
            2: "水平翻转",
            3: "旋转 180°",
            4: "垂直翻转",
            5: "顺时针 90° + 水平翻转",
            6: "顺时针 90°",
            7: "逆时针 90° + 水平翻转",
            8: "逆时针 90°"
        };
        fmt.orientation = orientations[exif.orientation] || "未知";
    }
    if (exif.cameraOwnerName) fmt.owner = exif.cameraOwnerName;
    if (exif.software) fmt.software = exif.software;
    if (exif.gpsLatitude && exif.gpsLatitudeRef && exif.gpsLongitude && exif.gpsLongitudeRef) {
        fmt.gps = `${formatGpsCoordinate(exif.gpsLatitude, exif.gpsLatitudeRef)}, ${formatGpsCoordinate(exif.gpsLongitude, exif.gpsLongitudeRef)}`;
    }
    return fmt;
}

function formatGpsCoordinate(value, ref) {
    if (!Array.isArray(value) || value.length < 3) return "";
    const [deg, min, sec] = value;
    const degrees = Number(deg);
    const minutes = Number(min);
    const seconds = Number(sec);
    return `${ref} ${degrees}°${minutes}′${seconds.toFixed(1)}″`;
}

function normalizeExifDateTime(value) {
    if (!value || typeof value !== "string") return value;
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{4})[:\-\.](\d{2})[:\-\.](\d{2})(.*)$/);
    if (match) {
        return `${match[1]}.${match[2]}.${match[3]}${match[4]}`;
    }
    return trimmed;
}

// =========================================
// Prompts
// =========================================

const SYSTEM_PROMPT_PRO = `
你是一名专业摄影评论家与视觉艺术导师。

【分析流程】
1. 先判断摄影类型（风光、人像、人文纪实、街头、建筑、微距、静物、动物、运动、夜景/天文等）。
2. 基于类型调用对应评价维度，不同类侧重点不同：
   - 风光：构图层次、光影氛围、色彩和谐、前景/中景/远景关系。
   - 人像：情绪表达、眼神/姿态、背景与主体关系、肤色还原、焦外质量。
   - 人文/纪实：瞬间抓取、故事性、环境信息、时代感。
   - 街头：决定性瞬间、光影几何、环境张力、戏剧性。
   - 建筑：线条透视、空间结构、光影切割、材质表现。
   - 微距/静物：细节质感、景深控制、布光、背景纯净度。
   - 动物/生态：动态捕捉、眼神光、环境融合。
   - 夜景/天文：曝光控制、星点/光轨质量、暗部噪点、地景与天空平衡。
3. 在 photo_type 字段写明判断的类型。

【输出规则】
- 必须输出合法 JSON，不允许 Markdown，不允许额外解释。
- 所有评分 0-10，客观诚实，允许各维度拉开差距。
- 以爱好者标准评价普通作品，不刻意找缺点，不攻击创作者。
- 优先指出作品成立的部分，再讨论可优化之处。
- 构图、光影、色彩分析应同时考虑前期与后期。
- 使用"可以进一步优化""如果调整会更好"等建设性表达。

【评分参考】
- 1-3：基础缺失或严重失误。
- 4-5：爱好者普通水平，有明显不足。
- 6：及格，完整但缺乏亮点。
- 7：良好，有可取之处。
- 8：优秀，至少一个维度突出。
- 9：出色，接近专业水准。
- 10：卓越，具艺术感染力。

【评分原则】
- 该高则高、该低则低，综合评分不是平均分，可偏向最突出或最拖后腿的维度。

JSON结构如下：
{
  "photo_type": "",
  "photography_style": [],
  "overall_summary": "",
  "scores": { "composition": 0, "lighting": 0, "color": 0, "storytelling": 0, "overall": 0 },
  "composition": { "analysis": "", "strengths": [], "improvements": [], "suggestions": [] },
  "lighting": { "analysis": "", "strengths": [], "improvements": [], "suggestions": [] },
  "color": { "analysis": "", "strengths": [], "improvements": [], "suggestions": [] },
  "storytelling": { "analysis": "", "strengths": [], "improvements": [], "suggestions": [] },
  "advanced_analysis": { "visual_focus": "", "depth_and_layers": "", "visual_flow": "", "emotional_tone": "", "style_reference": [] }
}
`;

const SYSTEM_PROMPT_BEGINNER = `
你是一名热情的摄影爱好者导师，擅长用温暖、易懂的语言帮助新手发现照片的美好。

【分析流程】
1. 先判断照片类型（风光、人像、人文、街头、建筑、微距、动物、夜景等）。
2. 从该类最打动人的角度分析，不用面面俱到：
   - 风光多聊构图和天气氛围；
   - 人像多聊情绪和眼神；
   - 人文多聊故事感和瞬间。
3. 用新手能听懂的话，像朋友一样交流。

【输出规则】
- 必须输出合法 JSON，不允许 Markdown，不允许额外解释。
- 评分 0-10，诚实但稍微宽容。
- 通俗语言，避免专业术语。
- 以鼓励和发现优点为主，建议简单、可执行。
- overall_summary 温暖自然，控制在 30 字以内。

JSON结构如下：
{
  "photo_type": "",
  "photography_style": [],
  "overall_summary": "",
  "scores": { "composition": 0, "lighting": 0, "color": 0, "storytelling": 0, "overall": 0 },
  "composition": { "analysis": "", "strengths": [], "improvements": [], "suggestions": [] },
  "lighting": { "analysis": "", "strengths": [], "improvements": [], "suggestions": [] },
  "color": { "analysis": "", "strengths": [], "improvements": [], "suggestions": [] },
  "storytelling": { "analysis": "", "strengths": [], "improvements": [], "suggestions": [] },
  "advanced_analysis": { "visual_focus": "", "depth_and_layers": "", "visual_flow": "", "emotional_tone": "", "style_reference": [] }
}
`;

const USER_PROMPT_PRO = `
请对这张摄影作品进行完整专业评价。

重点分析：构图、光线、色彩、情绪、叙事、摄影风格、专业完成度。
总体评价控制在60字以内，要求精炼。
`;

const USER_PROMPT_BEGINNER = `
请对这张摄影作品进行友好、鼓励性的评价。

像朋友一样和拍摄者聊聊：
- 这张照片最打动人的地方是什么？
- 有哪些值得表扬的优点？
- 给新手一两个简单、好上手的改进建议
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

document.getElementById("apiKey").addEventListener("blur", (e) => {
    const val = e.target.value.trim();
    if (val) {
        localStorage.setItem("ai_photo_api_key", val);
    }
});

// =========================================
// Mode Switcher
// =========================================

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

// =========================================
// Upload & Drag-Drop (with compression)
// =========================================

function handleFile(file) {
    if (isAnalyzing) {
        alert("AI 正在分析中，请等待完成后再上传新图片");
        return;
    }
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

// =========================================
// EXIF 展示卡片（上传后本地显示）
// =========================================

function renderExifCard(exif) {
    let existing = document.getElementById("exifDisplayCard");
    if (existing) existing.remove();
    if (!exif || Object.keys(exif).length === 0) return;

    const card = document.createElement("div");
    card.id = "exifDisplayCard";
    card.className = "card exif-display-card";

    const items = [];
    if (exif.camera) items.push(`<span class="exif-tag">📷 ${exif.camera}</span>`);
    if (exif.lens) items.push(`<span class="exif-tag">🔭 ${exif.lens}</span>`);
    if (exif.aperture) items.push(`<span class="exif-tag">🔍 ${exif.aperture}</span>`);
    if (exif.shutterSpeed) items.push(`<span class="exif-tag">⏱ ${exif.shutterSpeed}</span>`);
    if (exif.iso) items.push(`<span class="exif-tag">⚡ ${exif.iso}</span>`);
    if (exif.focalLength) items.push(`<span class="exif-tag">📐 ${exif.focalLength}</span>`);
    if (exif.focalLength35) items.push(`<span class="exif-tag">35mm 等效: ${exif.focalLength35}</span>`);
    if (exif.resolution) items.push(`<span class="exif-tag">🖼 ${exif.resolution}</span>`);
    if (exif.dateTime) items.push(`<span class="exif-tag">📅 ${exif.dateTime}</span>`);
    if (exif.exposureProgram) items.push(`<span class="exif-tag">🎚 ${exif.exposureProgram}</span>`);
    if (exif.metering) items.push(`<span class="exif-tag">🧭 ${exif.metering}</span>`);
    if (exif.flash) items.push(`<span class="exif-tag">⚡ ${exif.flash}</span>`);
    if (exif.whiteBalance) items.push(`<span class="exif-tag">🎨 ${exif.whiteBalance}</span>`);
    if (exif.orientation) items.push(`<span class="exif-tag">🔄 ${exif.orientation}</span>`);
    if (exif.owner) items.push(`<span class="exif-tag">👤 ${exif.owner}</span>`);
    if (exif.software) items.push(`<span class="exif-tag">💻 ${exif.software}</span>`);
    if (exif.gps) items.push(`<span class="exif-tag">📍 ${exif.gps}</span>`);

    if (items.length === 0) return;

    card.innerHTML = `
        <h3 class="section-title" style="font-size: 16px; margin-bottom: 20px;">拍摄参数</h3>
        <div class="exif-tags">${items.join("")}</div>
    `;

    const uploadCard = document.getElementById("dropZone");
    uploadCard.parentNode.insertBefore(card, uploadCard.nextSibling);
}

replaceBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isAnalyzing) {
        alert("AI 正在分析中，请等待完成后再更换图片");
        return;
    }
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
    if (isAnalyzing) {
        alert("AI 正在分析中，请等待完成后再上传新图片");
        return;
    }
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
});

uploadPlaceholder.addEventListener("click", () => {
    if (isAnalyzing) {
        alert("AI 正在分析中，请等待完成后再上传新图片");
        return;
    }
    imageInput.click();
});

// =========================================
// Loading Animation
// =========================================

function startFakeProgress() {
    const bar = document.getElementById("loadingProgress");
    bar.style.width = "0%";
    bar.style.transition = "width 0.8s cubic-bezier(0.22, 1, 0.36, 1)";

    setTimeout(() => bar.style.width = "15%", 300);

    let progress = 15;
    loadingProgressInterval = setInterval(() => {
        if (progress < 90) {
            progress += Math.random() * 5 + 2;
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

    // ✅ 自动保存到本地（验证通过后再存，避免存空值或错误值）
    localStorage.setItem("ai_photo_api_key", apiKey);

    isAnalyzing = true;

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
        isAnalyzing = false;
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

// =========================================
// Beginner Render
// =========================================

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

// =========================================
// Save Result as Image (Long Screenshot)
// =========================================

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
                clone.style.animation = "none";
                clone.style.opacity = "1";
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
                clone.style.animation = "none";
                clone.style.opacity = "1";
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
                        * { animation: none !important; transition: none !important; opacity: 1 !important; }
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
                        .title-card, .title-glass, .save-card {
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