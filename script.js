import { parseJsonWithBareQuoteRepair } from "./json-repair.js";

const imageInput = document.getElementById("imageInput");
const replaceBtn = document.getElementById("replaceBtn");
const previewImage = document.getElementById("previewImage");
const previewContainer = document.getElementById("previewContainer");
const uploadPlaceholder = document.getElementById("uploadPlaceholder");
const uploadLoading = document.getElementById("uploadLoading");
const analyzeBtn = document.getElementById("analyzeBtn");
const analyzeBtnText = document.getElementById("analyzeBtnText");
const dropZone = document.getElementById("dropZone");

const loadingSection = document.getElementById("loadingSection");
const loadingText = document.getElementById("loadingText");
const loadingSub = document.getElementById("loadingSub");
const loadingStage = document.getElementById("loadingStage");
const resultSection = document.getElementById("resultSection");
const outputPlaceholder = document.getElementById("outputPlaceholder");
const errorCard = document.getElementById("errorCard");
const errorCardType = document.getElementById("errorCardType");
const errorCardTitle = document.getElementById("errorCardTitle");
const errorCardDesc = document.getElementById("errorCardDesc");
const errorCardTips = document.getElementById("errorCardTips");
const retryAnalyzeBtn = document.getElementById("retryAnalyzeBtn");
const cancelAnalysisBtn = document.getElementById("cancelAnalysisBtn");
const modelUsedNote = document.getElementById("modelUsedNote");
const fallbackNotice = document.getElementById("fallbackNotice");
const retryFallbackBtn = document.getElementById("retryFallbackBtn");
const saveCardTitle = document.getElementById("saveCardTitle");
const saveCardDesc = document.getElementById("saveCardDesc");

let selectedFile = null;
let currentMode = "beginner";
let loadingStageInterval = null;
let analysisProgressInterval = null;
let extractedExif = null;
let isAnalyzing = false;
let activeRequestId = "";
let fileSelectionToken = 0;
let activeAnalysisXhr = null;
let feedbackAction = "retryAnalysis";

// =========================================
// 图片上传与代理响应由浏览器统一等待，服务端单独控制 Moonshot 超时。
// =========================================
const API_ENDPOINT = window.APP_CONFIG?.apiEndpoint || "/api/analyze";
const UPLOAD_TIMEOUT_MS = 45000;
const RESPONSE_TIMEOUT_MS = 330000;
const IMAGE_MAX_DIMENSION = 1920;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_INITIAL_QUALITY = 0.88;
const IMAGE_MIN_QUALITY = 0.58;

const DEFAULT_SECTION_ANALYSIS = "该维度信息不足，暂未展开详细分析。";
const DEFAULT_STRENGTHS = ["画面有明确的表达意图。"];
const DEFAULT_SUGGESTIONS = ["可以尝试换一个更稳定的模型后再次分析。"];

function setHidden(element, hidden) {
    if (!element) return;
    element.classList.toggle("hidden", hidden);
}

function updateAnalyzeButtonState() {
    const hasImage = Boolean(selectedFile);

    analyzeBtn.disabled = isAnalyzing || !hasImage;
    uploadPlaceholder.disabled = isAnalyzing;
    imageInput.disabled = isAnalyzing;
    replaceBtn.disabled = isAnalyzing;
    dropZone.classList.toggle("is-disabled", isAnalyzing);
    dropZone.setAttribute("aria-busy", String(isAnalyzing));
    document.querySelectorAll(".mode-card").forEach((card) => {
        card.disabled = isAnalyzing;
    });
}

function showErrorCard(state) {
    errorCard.classList.remove("hidden", "is-warning");
    if (state.level === "warning") {
        errorCard.classList.add("is-warning");
    }

    errorCardType.textContent = state.eyebrow;
    errorCardTitle.textContent = state.title;
    errorCardDesc.textContent = state.description;
    errorCardTips.innerHTML = "";

    (state.tips || []).forEach((tip) => {
        const tipItem = document.createElement("div");
        tipItem.className = "feedback-card__tip";
        tipItem.textContent = tip;
        errorCardTips.appendChild(tipItem);
    });

    retryAnalyzeBtn.textContent = state.actionLabel || "重新分析";
    feedbackAction = state.action || "retryAnalysis";

    setHidden(outputPlaceholder, true);
    setHidden(resultSection, !state.preserveResult);
    setHidden(loadingSection, true);
    errorCard.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideErrorCard() {
    errorCard.classList.add("hidden");
    errorCard.classList.remove("is-warning");
}

function createErrorState(kind, fallbackMessage) {
    const map = {
        validation: {
            eyebrow: "请先补齐信息",
            title: "还不能开始分析",
            description: fallbackMessage || "请先上传一张有效图片。",
            tips: ["请选择页面列出的图片格式，并确认当前浏览器能够正常预览该文件。"],
            actionLabel: "返回上传"
        },
        processing: {
            eyebrow: "请求仍在处理",
            title: "正在处理，请稍候",
            description: fallbackMessage || "相同的分析请求仍在后台处理中，暂时不需要重复提交。",
            tips: ["请等待片刻后再次尝试，完成后系统会复用已有结果。"],
            actionLabel: "稍后重试",
            level: "warning"
        },
        export: {
            eyebrow: "导出未完成",
            title: "长图生成失败",
            description: fallbackMessage || "浏览器没能成功生成或下载长图，请稍后重试。",
            tips: ["请确认浏览器允许下载文件。", "照片或评价内容较长时，可关闭其他占用内存的页面后重试。"],
            actionLabel: "知道了",
            action: "dismiss",
            preserveResult: true
        },
        timeout: {
            eyebrow: "请求超时",
            title: "这次分析花的时间有点久",
            description: "上传或 AI 分析超过等待时间，通常是网络波动或服务拥堵导致。",
            tips: ["请切换到更稳定的网络后重试。", "不要连续点击重试，同一请求会进行短时间去重。"],
            actionLabel: "重新分析"
        },
        format: {
            eyebrow: "返回格式异常",
            title: "模型没有按预期返回结构化结果",
            description: "这通常不是你的操作问题，而是当前模型输出了额外文字或截断了 JSON。",
            tips: ["系统已自动尝试全部后备模型。", "可以稍后重新分析，排除临时输出波动。"],
            actionLabel: "重新分析"
        },
        api: {
            eyebrow: "接口调用失败",
            title: "AI 服务暂时没有成功响应",
            description: fallbackMessage || "服务暂时不可用，请稍后重试。",
            tips: ["如果持续失败，可能是服务额度不足或上游暂时异常。"],
            actionLabel: "稍后重试"
        },
        payload: {
            eyebrow: "图片过大",
            title: "压缩后的图片仍超过上传限制",
            description: "请换一张尺寸更小的图片。",
            tips: ["上传前会自动压缩至 1920px / 5MB 以内。"],
            actionLabel: "调整后重试"
        },
        rateLimit: {
            eyebrow: "请求较多",
            title: "当前使用次数已达到限制",
            description: fallbackMessage || "请稍后再试，避免短时间重复提交。",
            tips: ["默认每个网络地址每小时 10 次、每天 50 次。"],
            actionLabel: "稍后重试"
        },
        captcha: {
            eyebrow: "安全验证未通过",
            title: "需要重新完成人机验证",
            description: fallbackMessage || "验证已过期或未完成，请刷新验证后重试。",
            tips: ["关闭拦截脚本的浏览器扩展后再试。"],
            actionLabel: "重新验证"
        },
        network: {
            eyebrow: "网络连接失败",
            title: "当前设备没能连上 AI 服务",
            description: "浏览器请求没有成功发出或返回，通常和网络环境有关。",
            tips: ["确认当前网络可访问对应 API。", "稍后重试，排除临时波动。"],
            actionLabel: "重新分析"
        },
        warning: {
            eyebrow: "操作提醒",
            title: "当前操作还不能执行",
            description: fallbackMessage || "请调整设置后再继续。",
            tips: [],
            actionLabel: "知道了",
            level: "warning"
        },
        generic: {
            eyebrow: "分析失败",
            title: "这次没有成功完成分析",
            description: fallbackMessage || "请稍后重试。",
            tips: ["确认网络连接正常。", "稍后重试，排除服务临时波动。"],
            actionLabel: "重新分析"
        }
    };

    return map[kind] || map.generic;
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
    if (exif.software) fmt.software = exif.software;
    return fmt;
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

// 阿里云验证码完成后，由接入脚本调用此方法写入一次性核验参数。
let captchaVerifyParam = "";
window.setPhotoEvaluatorCaptcha = (value) => {
    captchaVerifyParam = typeof value === "string" ? value : "";
};

retryAnalyzeBtn.addEventListener("click", () => {
    hideErrorCard();
    if (feedbackAction === "dismiss") {
        if (!resultSection.classList.contains("hidden")) {
            resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
    }
    if (!analyzeBtn.disabled) {
        analyzeBtn.click();
        return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
});

retryFallbackBtn.addEventListener("click", () => {
    if (!analyzeBtn.disabled) analyzeBtn.click();
});

updateAnalyzeButtonState();

// =========================================
// Mode Switcher
// =========================================

document.querySelectorAll(".mode-card").forEach(card => {
    card.addEventListener("click", () => {
        if (isAnalyzing) return;
        document.querySelectorAll(".mode-card").forEach(c => {
            c.classList.remove("active");
            c.setAttribute("aria-checked", "false");
        });
        card.classList.add("active");
        card.setAttribute("aria-checked", "true");
        currentMode = card.dataset.mode;
        activeRequestId = "";

        analyzeBtnText.textContent = currentMode === "professional"
            ? "开始专业分析"
            : "开始友好点评";

        loadingText.textContent = currentMode === "professional"
            ? "专业分析进行中"
            : "友好点评生成中";
        loadingSub.textContent = "可能需要一些时间，请保持页面开启";

        updateAnalyzeButtonState();
    });
});

// =========================================
// Upload & Drag-Drop (with compression)
// =========================================

function handleFile(file) {
    if (isAnalyzing) return;
    if (!isSupportedImageFile(file)) {
        showErrorCard(createErrorState("warning", "请选择有效的图片文件后重试。"));
        return;
    }

    const selectionToken = ++fileSelectionToken;
    selectedFile = null;
    activeRequestId = "";
    extractedExif = null;
    hideErrorCard();
    updateAnalyzeButtonState();

    uploadPlaceholder.classList.add("hidden");
    uploadLoading.classList.remove("hidden");
    previewContainer.classList.add("hidden");

    // 并行提取 EXIF
    extractExif(file).then(exif => {
        if (selectionToken !== fileSelectionToken) return;
        extractedExif = formatExif(exif);
        renderExifCard(extractedExif);

    });

    compressImage(file, {
        maxDimension: IMAGE_MAX_DIMENSION,
        maxBytes: IMAGE_MAX_BYTES,
        initialQuality: IMAGE_INITIAL_QUALITY,
        minQuality: IMAGE_MIN_QUALITY
    })
        .then(compressedFile => {
            if (selectionToken !== fileSelectionToken) return;
            selectedFile = compressedFile;
            useOriginalFile(compressedFile);
        })
        .catch(err => {
            if (selectionToken !== fileSelectionToken) return;
            console.error("图片压缩失败", err);
            selectedFile = null;
            uploadLoading.classList.add("hidden");
            uploadPlaceholder.classList.remove("hidden");
            showErrorCard(createErrorState("payload", "图片无法压缩到安全上传范围，请换一张图片。"));
            updateAnalyzeButtonState();
        });
}

function isSupportedImageFile(file) {
    if (!file) return false;
    const supportedMimeTypes = new Set([
        "image/jpeg", "image/png", "image/apng", "image/webp", "image/gif",
        "image/bmp", "image/x-ms-bmp", "image/avif", "image/heic", "image/heif",
        "image/heic-sequence", "image/heif-sequence", "image/tiff"
    ]);
    const supportedExtensions = new Set([
        "jpg", "jpeg", "jfif", "png", "apng", "webp", "gif", "bmp",
        "avif", "heic", "heif", "tif", "tiff"
    ]);
    const extension = String(file.name || "").split(".").pop().toLowerCase();
    return supportedMimeTypes.has(String(file.type || "").toLowerCase())
        || supportedExtensions.has(extension);
}

function useOriginalFile(file) {
    const selectionToken = fileSelectionToken;
    const reader = new FileReader();
    reader.onload = (event) => {
        if (selectionToken !== fileSelectionToken) return;
        previewImage.src = event.target.result;
        uploadLoading.classList.add("hidden");
        previewContainer.classList.remove("hidden");
        updateAnalyzeButtonState();
    };
    reader.onerror = () => {
        if (selectionToken !== fileSelectionToken) return;
        uploadLoading.classList.add("hidden");
        uploadPlaceholder.classList.remove("hidden");
        showErrorCard(createErrorState("warning", "图片读取失败，请换一张图片后重试。"));
    };
    reader.readAsDataURL(file);
}

function canvasToBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            blob => blob ? resolve(blob) : reject(new Error("图片编码失败")),
            "image/jpeg",
            quality
        );
    });
}

function createJpegFilename(filename) {
    const baseName = filename.replace(/\.[^.]+$/, "") || "photo";
    return `${baseName}.jpg`;
}

function compressImage(file, {
    maxDimension,
    maxBytes,
    initialQuality,
    minQuality
}) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = async () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;

            if (width > maxDimension || height > maxDimension) {
                if (width > height) {
                    height = Math.round(height * maxDimension / width);
                    width = maxDimension;
                } else {
                    width = Math.round(width * maxDimension / height);
                    height = maxDimension;
                }
            }

            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                reject(new Error("当前浏览器不支持图片压缩"));
                return;
            }

            try {
                let quality = initialQuality;
                let blob;

                while (true) {
                    canvas.width = width;
                    canvas.height = height;
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(0, 0, width, height);
                    ctx.drawImage(img, 0, 0, width, height);

                    blob = await canvasToBlob(canvas, quality);
                    if (blob.size <= maxBytes) break;

                    if (quality > minQuality) {
                        quality = Math.max(minQuality, quality - 0.08);
                    } else if (width > 960 || height > 960) {
                        width = Math.max(1, Math.round(width * 0.85));
                        height = Math.max(1, Math.round(height * 0.85));
                    } else {
                        break;
                    }
                }

                resolve(new File([blob], createJpegFilename(file.name), {
                    type: "image/jpeg",
                    lastModified: file.lastModified
                }));
            } catch (error) {
                reject(error);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("图片加载失败"));
        };

        img.src = url;
    });
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
    if (exif.camera) items.push(`<span class="exif-tag">📷 ${escapeHtml(exif.camera)}</span>`);
    if (exif.lens) items.push(`<span class="exif-tag">🔭 ${escapeHtml(exif.lens)}</span>`);
    if (exif.aperture) items.push(`<span class="exif-tag">🔍 ${escapeHtml(exif.aperture)}</span>`);
    if (exif.shutterSpeed) items.push(`<span class="exif-tag">⏱ ${escapeHtml(exif.shutterSpeed)}</span>`);
    if (exif.iso) items.push(`<span class="exif-tag">⚡ ${escapeHtml(exif.iso)}</span>`);
    if (exif.focalLength) items.push(`<span class="exif-tag">📐 ${escapeHtml(exif.focalLength)}</span>`);
    if (exif.focalLength35) items.push(`<span class="exif-tag">35mm 等效: ${escapeHtml(exif.focalLength35)}</span>`);
    if (exif.resolution) items.push(`<span class="exif-tag">🖼 ${escapeHtml(exif.resolution)}</span>`);
    if (exif.dateTime) items.push(`<span class="exif-tag">📅 ${escapeHtml(exif.dateTime)}</span>`);
    if (exif.exposureProgram) items.push(`<span class="exif-tag">🎚 ${escapeHtml(exif.exposureProgram)}</span>`);
    if (exif.metering) items.push(`<span class="exif-tag">🧭 ${escapeHtml(exif.metering)}</span>`);
    if (exif.flash) items.push(`<span class="exif-tag">⚡ ${escapeHtml(exif.flash)}</span>`);
    if (exif.whiteBalance) items.push(`<span class="exif-tag">🎨 ${escapeHtml(exif.whiteBalance)}</span>`);
    if (exif.orientation) items.push(`<span class="exif-tag">🔄 ${escapeHtml(exif.orientation)}</span>`);
    if (exif.software) items.push(`<span class="exif-tag">💻 ${escapeHtml(exif.software)}</span>`);

    if (items.length === 0) return;

    card.innerHTML = `
        <h3 class="section-title">拍摄参数</h3>
        <div class="exif-tags">${items.join("")}</div>
    `;

    const uploadCard = document.getElementById("dropZone");
    uploadCard.parentNode.insertBefore(card, uploadCard.nextSibling);
}

replaceBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isAnalyzing) return;
    imageInput.click();
});

imageInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
    e.target.value = "";
});

// Drag & Drop
dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (isAnalyzing) return;
    dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    if (isAnalyzing) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
});

uploadPlaceholder.addEventListener("click", () => {
    if (isAnalyzing) return;
    imageInput.click();
});

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

function startAnalysisProgress() {
    const bar = document.getElementById("loadingProgress");
    clearInterval(analysisProgressInterval);
    let progress = 15;

    bar.style.transition = "width 0.8s cubic-bezier(0.22, 1, 0.36, 1)";
    bar.style.width = `${progress}%`;

    analysisProgressInterval = setInterval(() => {
        if (progress >= 92) return;
        const remaining = 92 - progress;
        progress = Math.min(92, progress + Math.max(0.4, Math.min(3, remaining * 0.08)));
        bar.style.width = `${progress}%`;
    }, 1800);
}

function stopLoadingAnimation() {
    clearInterval(loadingStageInterval);
    clearInterval(analysisProgressInterval);

    const bar = document.getElementById("loadingProgress");
    bar.style.transition = "width 0.3s ease";
    bar.style.width = "100%";

    setTimeout(() => {
        bar.style.width = "0%";
    }, 500);
}

function normalizeStringArray(value, fallback = []) {
    if (!Array.isArray(value)) return [...fallback];
    const items = value
        .map((item) => typeof item === "string" ? item.trim() : "")
        .filter(Boolean);
    return items.length ? items : [...fallback];
}

function normalizeScore(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.min(10, Math.max(0, Math.round(num * 10) / 10));
}

function normalizeSection(section, fallbackAnalysis = DEFAULT_SECTION_ANALYSIS) {
    return {
        analysis: typeof section?.analysis === "string" && section.analysis.trim()
            ? section.analysis.trim()
            : fallbackAnalysis,
        strengths: normalizeStringArray(section?.strengths, []),
        improvements: normalizeStringArray(section?.improvements, []),
        suggestions: normalizeStringArray(section?.suggestions, [])
    };
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function extractFirstJsonObject(text) {
    if (typeof text !== "string") return null;

    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            continue;
        }

        if (char === "{") {
            if (depth === 0) start = i;
            depth += 1;
            continue;
        }

        if (char === "}") {
            if (depth === 0) continue;
            depth -= 1;
            if (depth === 0 && start !== -1) {
                return text.slice(start, i + 1);
            }
        }
    }

    return null;
}

function buildFallbackResultFromRawText(rawContent) {
    const normalizedText = String(rawContent || "").trim();
    const shortSummary = normalizedText
        ? normalizedText.replace(/\s+/g, " ").slice(0, 80)
        : "AI 返回了文字结果，已为你降级展示。";

    return {
        photo_type: "待确认",
        photography_style: ["降级展示"],
        overall_summary: shortSummary,
        scores: {
            composition: 0,
            lighting: 0,
            color: 0,
            storytelling: 0,
            overall: 0
        },
        composition: {
            analysis: normalizedText || DEFAULT_SECTION_ANALYSIS,
            strengths: DEFAULT_STRENGTHS,
            improvements: [],
            suggestions: DEFAULT_SUGGESTIONS
        },
        lighting: normalizeSection(null),
        color: normalizeSection(null),
        storytelling: normalizeSection(null),
        advanced_analysis: {
            visual_focus: "",
            depth_and_layers: "",
            visual_flow: "",
            emotional_tone: "",
            style_reference: []
        },
        meta: {
            parseStrategy: "fallback-text",
            rawText: normalizedText
        }
    };
}

function standardizeResult(result, meta = {}) {
    const raw = result && typeof result === "object" ? result : {};
    const standardized = {
        photo_type: typeof raw.photo_type === "string" && raw.photo_type.trim() ? raw.photo_type.trim() : "未识别类型",
        photography_style: normalizeStringArray(raw.photography_style, []),
        overall_summary: typeof raw.overall_summary === "string" && raw.overall_summary.trim()
            ? raw.overall_summary.trim()
            : "AI 已完成分析，但总结信息较少。",
        scores: {
            composition: normalizeScore(raw.scores?.composition),
            lighting: normalizeScore(raw.scores?.lighting),
            color: normalizeScore(raw.scores?.color),
            storytelling: normalizeScore(raw.scores?.storytelling),
            overall: normalizeScore(raw.scores?.overall)
        },
        composition: normalizeSection(raw.composition),
        lighting: normalizeSection(raw.lighting),
        color: normalizeSection(raw.color),
        storytelling: normalizeSection(raw.storytelling),
        advanced_analysis: {
            visual_focus: typeof raw.advanced_analysis?.visual_focus === "string" ? raw.advanced_analysis.visual_focus.trim() : "",
            depth_and_layers: typeof raw.advanced_analysis?.depth_and_layers === "string" ? raw.advanced_analysis.depth_and_layers.trim() : "",
            visual_flow: typeof raw.advanced_analysis?.visual_flow === "string" ? raw.advanced_analysis.visual_flow.trim() : "",
            emotional_tone: typeof raw.advanced_analysis?.emotional_tone === "string" ? raw.advanced_analysis.emotional_tone.trim() : "",
            style_reference: normalizeStringArray(raw.advanced_analysis?.style_reference, [])
        },
        meta: {
            parseStrategy: meta.parseStrategy || "direct-json",
            rawText: meta.rawText || ""
        }
    };

    return standardized;
}

function parseAiResult(rawContent) {
    const directText = typeof rawContent === "string" ? rawContent.trim() : "";
    const candidates = [
        { strategy: "direct-json", text: directText }
    ];
    const extracted = extractFirstJsonObject(directText);
    if (extracted && extracted !== directText) {
        candidates.push({ strategy: "extracted-json", text: extracted });
    }

    for (const candidate of candidates) {
        if (!candidate.text) continue;
        try {
            const parsed = parseJsonWithBareQuoteRepair(candidate.text);
            const parseStrategy = parsed.repaired ? "repaired-json" : candidate.strategy;
            return standardizeResult(parsed.value, { parseStrategy, rawText: directText });
        } catch (_) {
            // continue to next strategy
        }
    }

    return standardizeResult(buildFallbackResultFromRawText(directText), {
        parseStrategy: "fallback-text",
        rawText: directText
    });
}

// =========================================
// Analyze through the same-origin security proxy
// =========================================

function createRequestId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildSafeExifPayload() {
    if (!extractedExif) return {};
    const allowedFields = [
        "dateTime", "aperture", "shutterSpeed", "iso", "focalLength",
        "focalLength35", "camera", "lens", "exposureProgram", "metering",
        "flash", "whiteBalance", "orientation"
    ];
    return Object.fromEntries(
        allowedFields
            .filter((key) => extractedExif[key])
            .map((key) => [key, String(extractedExif[key]).slice(0, 160)])
    );
}

function requestAnalysis({ file, mode, requestId }) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        let uploadTimer = null;
        let responseTimer = null;
        let uploadFinished = false;
        let settled = false;
        let abortCode = "";

        formData.append("image", file, file.name);
        formData.append("mode", mode);
        formData.append("requestId", requestId);
        formData.append("exif", JSON.stringify(buildSafeExifPayload()));
        if (captchaVerifyParam) {
            formData.append("captchaVerifyParam", captchaVerifyParam);
        }

        const cleanup = () => {
            clearTimeout(uploadTimer);
            clearTimeout(responseTimer);
            if (activeAnalysisXhr === xhr) activeAnalysisXhr = null;
        };

        const succeed = (data) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(data);
        };

        const fail = (message, code, status = 0) => {
            if (settled) return;
            settled = true;
            cleanup();
            const error = new Error(message);
            error.code = code;
            error.status = status;
            reject(error);
        };

        xhr.open("POST", API_ENDPOINT);
        xhr.responseType = "json";
        activeAnalysisXhr = xhr;

        uploadTimer = setTimeout(() => {
            if (!uploadFinished) {
                abortCode = "UPLOAD_TIMEOUT";
                xhr.abort();
            }
        }, UPLOAD_TIMEOUT_MS);

        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable) return;
            const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
            const totalProgress = Math.round(percent * 0.15);
            loadingText.textContent = "正在上传图片...";
            loadingSub.textContent = `已上传 ${percent}%`;
            loadingStage.textContent = "图片仅上传一次，请保持页面开启";
            document.getElementById("loadingProgress").style.width = `${totalProgress}%`;
        };

        xhr.upload.onload = () => {
            uploadFinished = true;
            captchaVerifyParam = "";
            clearTimeout(uploadTimer);
            loadingText.textContent = currentMode === "professional" ? "专业分析进行中" : "友好点评生成中";
            loadingSub.textContent = "可能需要一些时间，请保持页面开启";
            startAnalysisProgress();
            startStageRotation();
            responseTimer = setTimeout(() => {
                abortCode = "ANALYSIS_TIMEOUT";
                xhr.abort();
            }, RESPONSE_TIMEOUT_MS);
        };

        xhr.onload = () => {
            const data = xhr.response || {};
            if (xhr.status >= 200 && xhr.status < 300) {
                succeed(data);
                return;
            }
            fail(data.message || `服务返回 HTTP ${xhr.status}`, data.code || "API_ERROR", xhr.status);
        };

        xhr.onerror = () => {
            fail("网络连接失败", "NETWORK_ERROR");
        };

        xhr.onabort = () => {
            if (abortCode === "UPLOAD_TIMEOUT") {
                fail("图片上传超时", "UPLOAD_TIMEOUT");
            } else if (abortCode === "ANALYSIS_TIMEOUT") {
                fail("AI 分析超时", "ANALYSIS_TIMEOUT");
            } else {
                fail("已取消本次分析", "USER_CANCELLED");
            }
        };

        xhr.send(formData);
    });
}

cancelAnalysisBtn.addEventListener("click", () => {
    if (!isAnalyzing || !activeAnalysisXhr) return;
    cancelAnalysisBtn.disabled = true;
    cancelAnalysisBtn.textContent = "正在取消...";
    activeAnalysisXhr.abort();
});

analyzeBtn.addEventListener("click", async () => {
    if (!selectedFile) {
        showErrorCard(createErrorState("validation", "请先上传图片，再开始分析。"));
        return;
    }

    isAnalyzing = true;
    const requestedMode = currentMode;

    resetAnalysisState();
    hideErrorCard();
    updateAnalyzeButtonState();

    const originalBtnText = analyzeBtnText.textContent;
    analyzeBtnText.textContent = "分析中...";
    cancelAnalysisBtn.disabled = false;
    cancelAnalysisBtn.textContent = "取消分析";

    loadingSection.classList.remove("hidden");
    resultSection.classList.add("hidden");
    outputPlaceholder.classList.add("hidden");

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

    const progressBar = document.getElementById("loadingProgress");
    progressBar.style.width = "0%";
    loadingText.textContent = "正在上传图片...";
    loadingSub.textContent = "正在建立安全连接";
    loadingStage.textContent = "准备上传压缩后的图片";
    loadingSection.scrollIntoView({ behavior: "smooth", block: "center" });

    try {
        if (!activeRequestId) activeRequestId = createRequestId();
        const response = await requestAnalysis({
            file: selectedFile,
            mode: requestedMode,
            requestId: activeRequestId
        });
        const result = parseAiResult(response.rawContent);

        modelUsedNote.textContent = `本次分析使用模型：${response.model}${response.deduplicated ? "（复用已有结果）" : ""}`;

        if (requestedMode === "professional") {
            renderResultProfessional(result);
        } else {
            renderResultBeginner(result);
        }

    } catch (error) {
        if (error.code === "USER_CANCELLED") {
            setHidden(outputPlaceholder, false);
            hideErrorCard();
        } else if (error.status === 409 || error.code === "REQUEST_IN_PROGRESS") {
            showErrorCard(createErrorState("processing", error.message));
        } else if (error.code === "UPLOAD_TIMEOUT" || error.code === "ANALYSIS_TIMEOUT") {
            showErrorCard(createErrorState("timeout"));
        } else if (error.status === 413 || error.code === "PAYLOAD_TOO_LARGE") {
            showErrorCard(createErrorState("payload", error.message));
        } else if (error.status === 429 || error.code === "RATE_LIMITED") {
            showErrorCard(createErrorState("rateLimit", error.message));
        } else if (error.code === "CAPTCHA_REQUIRED" || error.code === "CAPTCHA_FAILED") {
            showErrorCard(createErrorState("captcha", error.message));
        } else if (error.message.includes('JSON') || error.message.includes('格式异常')) {
            showErrorCard(createErrorState("format"));
        } else if (error.status >= 500 || error.code === "UPSTREAM_ERROR") {
            showErrorCard(createErrorState("api", error.message));
        } else if (error.code === "NETWORK_ERROR") {
            showErrorCard(createErrorState("network"));
        } else {
            showErrorCard(createErrorState("generic", `分析失败：${error.message}`));
        }
        if (error.code !== "USER_CANCELLED") {
            console.error("完整错误：", error);
        }

    } finally {
        stopLoadingAnimation();
        loadingSection.classList.add("hidden");
        analyzeBtnText.textContent = originalBtnText;
        isAnalyzing = false;
        updateAnalyzeButtonState();
    }
});

function resetAnalysisState() {
    clearInterval(loadingStageInterval);
    clearInterval(analysisProgressInterval);
    loadingStageInterval = null;
    analysisProgressInterval = null;

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
    if (modelUsedNote) modelUsedNote.textContent = "";
    setHidden(fallbackNotice, true);
    saveCardTitle.textContent = "评价已生成";
    saveCardDesc.textContent = "可以将结果保存为图片分享";

    document.getElementById("summaryCard").classList.add("hidden");
    document.getElementById("scoreGrid").classList.add("hidden");
    document.getElementById("analysisContainer").classList.add("hidden");
    document.getElementById("encouragementCard").classList.add("hidden");
    document.getElementById("tipsCard").classList.add("hidden");
    document.getElementById("praiseCard").classList.add("hidden");
    outputPlaceholder.classList.remove("hidden");
}

function updateFallbackNotice(result) {
    const isFallback = result.meta?.parseStrategy === "fallback-text";
    setHidden(fallbackNotice, !isFallback);
    saveCardTitle.textContent = isFallback ? "已生成简化结果" : "评价已生成";
    saveCardDesc.textContent = isFallback
        ? "部分内容可能缺失，保存或分享前请留意上方提示"
        : "可以将结果保存为图片分享";
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
    hideErrorCard();
    updateFallbackNotice(result);

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
            <p>${escapeHtml(sectionData.analysis || "")}</p>
            ${renderListSection("优点", sectionData.strengths)}
            ${renderListSection("可优化点", sectionData.improvements)}
            ${renderListSection("修改建议", sectionData.suggestions)}
        `;
        analysisContainer.appendChild(card);
    });

    if (result.meta?.parseStrategy === "fallback-text" && result.meta?.rawText) {
        const rawCard = document.createElement("div");
        rawCard.className = "analysis-card";
        rawCard.innerHTML = `
            <h2>AI 原始评价</h2>
            <p>${escapeHtml(result.meta.rawText)}</p>
        `;
        analysisContainer.appendChild(rawCard);
    }

    setTimeout(() => {
        resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
}

// =========================================
// Beginner Render
// =========================================

function renderResultBeginner(result) {
    resultSection.classList.remove("hidden");
    hideErrorCard();
    updateFallbackNotice(result);

    // Hide all professional sections
    document.getElementById("summaryCard").classList.add("hidden");
    document.getElementById("scoreGrid").classList.add("hidden");
    document.getElementById("analysisContainer").classList.add("hidden");

    // Show beginner sections
    document.getElementById("encouragementCard").classList.remove("hidden");
    document.getElementById("praiseCard").classList.remove("hidden");
    document.getElementById("tipsCard").classList.remove("hidden");

    // Encouragement
    document.getElementById("encouragementText").textContent = result.meta?.parseStrategy === "fallback-text" && result.meta?.rawText
        ? result.meta.rawText
        : result.overall_summary || "这是一张很有感觉的照片！";

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
            <span class="tip-text">${escapeHtml(p)}</span>
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
            <span class="tip-text">${escapeHtml(tip)}</span>
        `;
        tipsList.appendChild(div);
    });

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
                ${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}
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
    let tempContainer = null;
    saveImageBtn.innerHTML = `<div class="spinner-small btn-inline-spinner"></div>生成中...`;
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
        tempContainer = document.createElement("div");
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

        if (!fallbackNotice.classList.contains("hidden")) {
            const fallbackClone = fallbackNotice.cloneNode(true);
            fallbackClone.removeAttribute("id");
            fallbackClone.querySelector("#retryFallbackBtn")?.remove();
            fallbackClone.classList.remove("hidden");
            fallbackClone.style.animation = "none";
            fallbackClone.style.opacity = "1";
            contentWrapper.appendChild(fallbackClone);
        }

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
                        // html2canvas can omit CSS transforms on SVG elements.
                        // Bake the page's -90deg rotation into the circle geometry.
                        ringSvg.style.transform = "none";
                        ringSvg.querySelectorAll("circle").forEach(circle => {
                            circle.setAttribute("transform", "rotate(-90 70 70)");
                        });
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

        const exportMeta = document.createElement("div");
        exportMeta.style.cssText = `
            margin: -4px 0 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            font-size: 12px;
            color: ${exportTextSecondary};
        `;

        if (modelUsedNote.textContent) {
            const modelNoteClone = modelUsedNote.cloneNode(true);
            modelNoteClone.removeAttribute("id");
            modelNoteClone.style.cssText = `margin: 0; color: ${exportTextSecondary};`;
            exportMeta.appendChild(modelNoteClone);
        }

        const timestamp = document.createElement("span");
        timestamp.textContent = `生成时间：${new Date().toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).replace(/\//g, "-")}`;
        timestamp.style.cssText = `margin-left: auto; white-space: nowrap; color: ${exportTextSecondary};`;
        exportMeta.appendChild(timestamp);
        contentWrapper.appendChild(exportMeta);

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
                        .ring-label { color: ${exportTextSecondary} !important; }
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
        tempContainer.remove();
        tempContainer = null;

    } catch (err) {
        console.error("保存图片失败:", err);
        showErrorCard(createErrorState("export", err?.message ? `保存图片失败：${err.message}` : ""));
    } finally {
        if (tempContainer?.isConnected) tempContainer.remove();
        saveImageBtn.innerHTML = btnText;
        saveImageBtn.disabled = false;
    }
});
