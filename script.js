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
let currentResult = null;
let currentImageBase64 = null;
let shareHTMLBlobUrl = null;

// =========================================
// 请求超时时间：300 秒（5 分钟）
// =========================================
const REQUEST_TIMEOUT_MS = 300000;

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
14. 问题分析应使用"可以进一步优化""如果调整会更好"等建设性表达

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
    "style_reference": []
  }
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
    "style_reference": []
  }
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
        if (extractedExif) {
            renderExifCard(extractedExif);
        }
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
        <h3 class="section-title" style="font-size: 16px; margin-bottom: 12px;">拍摄参数</h3>
        <div class="exif-tags">${items.join("")}</div>
    `;

    const uploadCard = document.getElementById("dropZone");
    uploadCard.parentNode.insertBefore(card, uploadCard.nextSibling);
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
    document.getElementById("shareSection").classList.add("hidden");

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
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        startStageRotation();

        const imageBase64 = await fileToBase64(selectedFile);
    currentImageBase64 = imageBase64;
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

    const scoreMap = {
        composition: "构图",
        lighting: "光影",
        color: "色彩",
        storytelling: "叙事",
        post_processing: "后期",
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

    setTimeout(() => {
        resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);

    currentResult = result;
    document.getElementById("shareSection").classList.remove("hidden");
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
    ["composition", "lighting", "color", "storytelling", "post_processing"].forEach(key => {
        const section = result[key];
        if (section && section.strengths) {
            section.strengths.forEach(s => allPraise.push(s));
        }
    });
    allPraise = [...new Set(allPraise)].slice(0, 3);
    if (allPraise.length === 0) {
        allPraise = ["画面有清晰的视觉中心", "色彩氛围自然舒适", "整体构图有良好的节奏感"];
    }
    allPraise.forEach((p, index) => {
        const li = document.createElement("li");
        li.textContent = `${index + 1}. ${p}`;
        praiseList.appendChild(li);
    });

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

    setTimeout(() => {
        resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);

    currentResult = result;
    document.getElementById("shareSection").classList.remove("hidden");
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
// Share Feature
// =========================================

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function generateShareHTML(result, mode, imageBase64) {
    const isPro = mode === "professional";
    const overallScore = result.scores?.overall ?? 0;
    const photoType = result.photo_type || "摄影作品";
    const summary = result.overall_summary || (isPro ? "专业分析报告" : "这是一张很有感觉的照片！");

    // Build style tags
    const styleTags = (result.photography_style || [])
        .map(s => `<span class="tag">${escapeHtml(s)}</span>`)
        .join("");

    // Build scores
    let scoresHTML = "";
    if (isPro) {
        const scoreMap = {
            composition: "构图",
            lighting: "光影",
            color: "色彩",
            storytelling: "叙事",
            post_processing: "后期",
            overall: "综合"
        };
        const scoreEntries = Object.entries(result.scores || {});
        scoresHTML = `
        <div class="scores-grid">
            ${scoreEntries.map(([key, value]) => `
                <div class="score-box">
                    <div class="score-box-label">${scoreMap[key] || key}</div>
                    <div class="score-box-value">${Number(value).toFixed(1)}</div>
                    <div class="score-box-bar"><div style="width:${Math.min(Number(value) * 10, 100)}%"></div></div>
                </div>
            `).join("")}
        </div>`;
    } else {
        scoresHTML = `
        <div class="beginner-score">
            <div class="score-circle">
                <span class="score-num">${Number(overallScore).toFixed(1)}</span>
                <span class="score-den">/10</span>
            </div>
            <p class="score-label">综合评分</p>
        </div>`;
    }

    // Build analysis content
    let analysisHTML = "";
    if (isPro) {
        const sections = [
            ["composition", "构图分析", "#007AFF"],
            ["lighting", "光影分析", "#FF9500"],
            ["color", "色彩分析", "#FF2D55"],
            ["storytelling", "叙事分析", "#AF52DE"],
            ["post_processing", "后期分析", "#34C759"]
        ];
        analysisHTML = sections.map(([key, title, color]) => {
            const section = result[key];
            if (!section) return "";
            let html = `
            <div class="analysis-box" style="border-left-color:${color}">
                <h3 style="color:${color}">${title}</h3>
                <p class="analysis-text">${escapeHtml(section.analysis || "")}</p>`;

            if (section.strengths?.length) {
                html += `
                <div class="list-section">
                    <h4>优点</h4>
                    <ul>${section.strengths.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
                </div>`;
            }
            if (section.improvements?.length) {
                html += `
                <div class="list-section">
                    <h4>可优化</h4>
                    <ul>${section.improvements.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
                </div>`;
            }
            if (section.suggestions?.length) {
                html += `
                <div class="list-section">
                    <h4>建议</h4>
                    <ul>${section.suggestions.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
                </div>`;
            }
            html += `</div>`;
            return html;
        }).join("");
    } else {
        // Collect praise and tips
        let allPraise = [];
        let allSuggestions = [];
        ["composition", "lighting", "color", "storytelling", "post_processing"].forEach(key => {
            const section = result[key];
            if (section?.strengths) allPraise.push(...section.strengths);
            if (section?.suggestions) allSuggestions.push(...section.suggestions);
        });
        allPraise = [...new Set(allPraise)].slice(0, 3);
        allSuggestions = [...new Set(allSuggestions)].slice(0, 3);

        if (allPraise.length === 0) {
            allPraise = ["画面有清晰的视觉中心", "色彩氛围自然舒适", "整体构图有良好的节奏感"];
        }
        if (allSuggestions.length === 0) {
            allSuggestions = ["多尝试不同角度拍摄", "留意自然光线的变化"];
        }

        analysisHTML = `
        <div class="praise-box">
            <h3>✨ 值得表扬</h3>
            <ul>${allPraise.map(p => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
        </div>
        <div class="tips-box">
            <h3>💡 小建议</h3>
            <ul>${allSuggestions.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
        </div>`;
    }

    // QR Code
    const qrText = isPro
        ? `AI摄影评价 | ${photoType} | 评分: ${Number(overallScore).toFixed(1)}/10 | ${summary}`
        : `AI摄影评价 | ${summary}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrText)}`;

    const now = new Date().toLocaleString("zh-CN");

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI 摄影评价报告</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    background: #f5f5f7;
    color: #1d1d1f;
    line-height: 1.6;
    padding: 20px;
}
.container {
    max-width: 720px;
    margin: 0 auto;
    background: #fff;
    border-radius: 24px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.08);
    overflow: hidden;
}
header {
    background: linear-gradient(135deg, #007AFF 0%, #0A84FF 100%);
    color: white;
    padding: 32px;
    text-align: center;
}
.logo { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
.date { font-size: 13px; opacity: 0.8; margin-top: 8px; }
.photo-frame {
    padding: 32px 32px 0;
}
.photo-frame img {
    width: 100%;
    border-radius: 16px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
    display: block;
}
.meta {
    padding: 20px 32px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
}
.badge, .tag {
    padding: 6px 14px;
    border-radius: 100px;
    font-size: 13px;
    font-weight: 600;
}
.badge {
    background: rgba(0,122,255,0.1);
    color: #007AFF;
}
.tag {
    background: #f5f5f7;
    color: #86868B;
}
.summary {
    padding: 0 32px 24px;
    font-size: 22px;
    font-weight: 700;
    line-height: 1.4;
    letter-spacing: -0.01em;
}
.scores-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    padding: 0 32px 24px;
}
.score-box {
    background: #f5f5f7;
    border-radius: 16px;
    padding: 16px;
    text-align: center;
}
.score-box-label { font-size: 12px; color: #86868B; font-weight: 600; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.03em; }
.score-box-value { font-size: 28px; font-weight: 700; color: #1d1d1f; margin-bottom: 8px; font-variant-numeric: tabular-nums; }
.score-box-bar { height: 4px; background: rgba(0,0,0,0.06); border-radius: 100px; overflow: hidden; }
.score-box-bar > div { height: 100%; background: linear-gradient(90deg, #007AFF, #5AC8FA); border-radius: 100px; }
.beginner-score { text-align: center; padding: 24px 32px; }
.score-circle { display: inline-flex; align-items: baseline; gap: 4px; }
.score-num { font-size: 56px; font-weight: 800; color: #007AFF; letter-spacing: -0.03em; line-height: 1; }
.score-den { font-size: 20px; color: #86868B; font-weight: 600; }
.score-label { font-size: 14px; color: #86868B; margin-top: 8px; font-weight: 500; }
.analysis-content { padding: 0 32px 24px; display: flex; flex-direction: column; gap: 16px; }
.analysis-box {
    background: #fff;
    border: 1px solid rgba(0,0,0,0.06);
    border-left: 4px solid;
    border-radius: 16px;
    padding: 24px;
}
.analysis-box h3 { font-size: 18px; font-weight: 700; margin-bottom: 12px; }
.analysis-text { color: #555; font-size: 15px; line-height: 1.7; margin-bottom: 16px; }
.list-section { margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(0,0,0,0.06); }
.list-section h4 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; color: #1d1d1f; }
.list-section ul { list-style: none; }
.list-section li { padding-left: 20px; position: relative; margin-bottom: 6px; font-size: 14px; color: #555; line-height: 1.5; }
.list-section li::before { content: ""; position: absolute; left: 0; top: 8px; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.6; }
.praise-box, .tips-box {
    background: linear-gradient(135deg, #F2F7FF 0%, #EDF4FF 100%);
    border: 1px solid rgba(0,122,255,0.12);
    border-radius: 16px;
    padding: 24px;
}
.tips-box { background: linear-gradient(135deg, #F0F9FF 0%, #E6F4FF 100%); }
.praise-box h3, .tips-box h3 { font-size: 16px; font-weight: 700; margin-bottom: 12px; color: #007AFF; }
.praise-box ul, .tips-box ul { list-style: none; }
.praise-box li, .tips-box li {
    padding: 12px 16px;
    background: rgba(255,255,255,0.8);
    border-radius: 12px;
    margin-bottom: 8px;
    font-size: 15px;
    color: #1d1d1f;
    line-height: 1.5;
    border: 1px solid rgba(0,122,255,0.06);
}
.qr-section {
    text-align: center;
    padding: 32px;
    border-top: 1px solid rgba(0,0,0,0.06);
    background: linear-gradient(180deg, #fff 0%, #fafafa 100%);
}
.qr-code {
    width: 180px;
    height: 180px;
    border-radius: 16px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    background: white;
    padding: 8px;
}
.qr-hint { font-size: 13px; color: #86868B; margin-top: 12px; font-weight: 500; }
footer {
    text-align: center;
    padding: 24px 32px;
    background: #f5f5f7;
    font-size: 13px;
    color: #86868B;
    border-top: 1px solid rgba(0,0,0,0.04);
}
@media (max-width: 600px) {
    body { padding: 0; background: #fff; }
    .container { border-radius: 0; box-shadow: none; }
    .scores-grid { grid-template-columns: repeat(2, 1fr); }
    header, .photo-frame, .meta, .summary, .scores-grid, .beginner-score, .analysis-content, .qr-section, footer { padding-left: 20px; padding-right: 20px; }
    .photo-frame { padding-top: 20px; }
    .summary { font-size: 20px; }
    .score-num { font-size: 48px; }
}
</style>
</head>
<body>
<div class="container">
    <header>
        <div class="logo">📷 AI 摄影评价</div>
        <div class="date">${now}</div>
    </header>

    <div class="photo-frame">
        <img src="${imageBase64}" alt="评价照片">
    </div>

    <div class="meta">
        ${photoType !== "摄影作品" ? `<span class="badge">${escapeHtml(photoType)}</span>` : ""}
        ${styleTags}
    </div>

    <h1 class="summary">${escapeHtml(summary)}</h1>

    ${scoresHTML}

    <div class="analysis-content">
        ${analysisHTML}
    </div>

    <div class="qr-section">
        <img src="${qrUrl}" alt="二维码" class="qr-code">
        <p class="qr-hint">扫码查看评价摘要</p>
    </div>

    <footer>
        <p>由 AI 摄影评价生成 · Designed by 猹猹🦡</p>
    </footer>
</div>
</body>
</html>`;
}

// Share button events
const shareBtn = document.getElementById("shareBtn");
const shareModal = document.getElementById("shareModal");
const shareModalOverlay = document.getElementById("shareModalOverlay");
const modalClose = document.getElementById("modalClose");
const downloadShareBtn = document.getElementById("downloadShareBtn");
const copyShareBtn = document.getElementById("copyShareBtn");

shareBtn.addEventListener("click", () => {
    if (!currentResult || !currentImageBase64) return;

    const html = generateShareHTML(currentResult, currentMode, currentImageBase64);

    const blob = new Blob([html], { type: 'text/html' });
    if (shareHTMLBlobUrl) URL.revokeObjectURL(shareHTMLBlobUrl);
    shareHTMLBlobUrl = URL.createObjectURL(blob);

    const frame = document.getElementById("sharePreviewFrame");
    frame.innerHTML = '';
    const iframe = document.createElement("iframe");
    iframe.src = shareHTMLBlobUrl;
    iframe.style.width = "100%";
    iframe.style.height = "500px";
    iframe.style.border = "none";
    iframe.style.display = "block";
    frame.appendChild(iframe);

    shareModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
});

function closeShareModal() {
    shareModal.classList.add("hidden");
    document.body.style.overflow = "";
}

shareModalOverlay.addEventListener("click", closeShareModal);
modalClose.addEventListener("click", closeShareModal);

downloadShareBtn.addEventListener("click", () => {
    if (!shareHTMLBlobUrl) return;
    const a = document.createElement("a");
    a.href = shareHTMLBlobUrl;
    a.download = `AI摄影评价_${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});

copyShareBtn.addEventListener("click", async () => {
    if (!currentResult || !currentImageBase64) return;
    const html = generateShareHTML(currentResult, currentMode, currentImageBase64);
    try {
        await navigator.clipboard.writeText(html);
        const btn = copyShareBtn;
        const original = btn.innerHTML;
        btn.innerHTML = "✅ 已复制";
        btn.style.borderColor = "#34C759";
        btn.style.color = "#34C759";
        setTimeout(() => {
            btn.innerHTML = original;
            btn.style.borderColor = "";
            btn.style.color = "";
        }, 2000);
    } catch (err) {
        alert("复制失败，请手动复制");
    }
});