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
