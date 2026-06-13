import http from "node:http";
import crypto from "node:crypto";
import { validateImage } from "./image-validation.js";
import { verifyCaptcha } from "./captcha.js";
import { analyzeWithMoonshot } from "./moonshot.js";
import { buildPrompts } from "./prompts.js";
import { createStore, enforceRateLimits } from "./store.js";

const MAX_REQUEST_BYTES = Number(process.env.MAX_REQUEST_BYTES || 8 * 1024 * 1024);
const MAX_EXIF_BYTES = 4096;
const RESULT_TTL_SECONDS = Number(process.env.RESULT_TTL_SECONDS || 600);
const LOCK_TTL_SECONDS = Number(process.env.LOCK_TTL_SECONDS || 360);
const IP_HASH_SALT = process.env.IP_HASH_SALT || "local-development-only";
if (process.env.NODE_ENV === "production" && !process.env.IP_HASH_SALT) {
    throw new Error("生产环境必须配置 IP_HASH_SALT");
}
const store = createStore();

function allowedOrigins(env = process.env) {
    const configured = String(env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    if (env.NODE_ENV !== "production") {
        configured.push("http://127.0.0.1:4173", "http://localhost:4173");
    }
    return new Set(configured);
}

function corsHeaders(req) {
    const origin = req.headers.origin;
    const allowed = allowedOrigins();
    if (!origin) return {};
    if (!allowed.has(origin)) {
        throw Object.assign(new Error("当前来源不允许访问此接口"), { code: "ORIGIN_NOT_ALLOWED", status: 403 });
    }
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
    };
}

function sendJson(res, status, body, headers = {}) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(payload),
        "Cache-Control": "no-store",
        ...headers
    });
    res.end(payload);
}

function clientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
        const chain = forwarded.split(",").map((value) => value.trim()).filter(Boolean);
        return chain.at(-1) || "unknown";
    }
    return req.socket.remoteAddress || "unknown";
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const declaredLength = Number(req.headers["content-length"] || 0);
        if (declaredLength > MAX_REQUEST_BYTES) {
            reject(Object.assign(new Error("请求体超过服务端限制"), { code: "PAYLOAD_TOO_LARGE", status: 413 }));
            return;
        }
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_REQUEST_BYTES) {
                reject(Object.assign(new Error("请求体超过服务端限制"), { code: "PAYLOAD_TOO_LARGE", status: 413 }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

async function parseMultipart(req) {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.startsWith("multipart/form-data;")) {
        throw Object.assign(new Error("请求必须使用 multipart/form-data"), { code: "INVALID_CONTENT_TYPE", status: 415 });
    }
    const body = await readBody(req);
    const request = new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": contentType },
        body
    });
    return request.formData();
}

function parseExif(value) {
    if (!value) return {};
    if (Buffer.byteLength(value, "utf8") > MAX_EXIF_BYTES) {
        throw Object.assign(new Error("EXIF 信息过长"), { code: "INVALID_EXIF", status: 400 });
    }
    let parsed;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw Object.assign(new Error("EXIF 格式无效"), { code: "INVALID_EXIF", status: 400 });
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return {};
    const allowed = new Set([
        "dateTime", "aperture", "shutterSpeed", "iso", "focalLength",
        "focalLength35", "camera", "lens", "exposureProgram", "metering",
        "flash", "whiteBalance", "orientation"
    ]);
    return Object.fromEntries(
        Object.entries(parsed)
            .filter(([key, value]) => allowed.has(key) && typeof value === "string")
            .map(([key, value]) => [key, value.slice(0, 160)])
    );
}

function validateRequestId(value) {
    const requestId = String(value || "");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) {
        throw Object.assign(new Error("请求 ID 无效"), { code: "INVALID_REQUEST_ID", status: 400 });
    }
    return requestId;
}

async function handleAnalyze(req, res, headers) {
    const startedAt = Date.now();
    const ip = clientIp(req);
    const ipHash = crypto.createHmac("sha256", IP_HASH_SALT)
        .update(ip)
        .digest("hex");
    const form = await parseMultipart(req);
    const requestId = validateRequestId(form.get("requestId"));
    const requestKey = crypto.createHash("sha256").update(`${ipHash}:${requestId}`).digest("hex");
    const resultKey = `result:${requestKey}`;
    const lockKey = `lock:${requestKey}`;
    const cached = await store.get(resultKey);

    if (cached) {
        console.info(JSON.stringify({
            requestId,
            status: 200,
            durationMs: Date.now() - startedAt,
            model: cached.model,
            deduplicated: true
        }));
        sendJson(res, 200, { ...cached, requestId, deduplicated: true }, headers);
        return;
    }

    const locked = await store.set(lockKey, { active: true }, LOCK_TTL_SECONDS, true);
    if (!locked) {
        throw Object.assign(new Error("相同请求正在处理中，请稍候"), { code: "REQUEST_IN_PROGRESS", status: 409 });
    }

    try {
        const mode = form.get("mode");
        if (!["beginner", "professional"].includes(mode)) {
            throw Object.assign(new Error("分析模式无效"), { code: "INVALID_MODE", status: 400 });
        }
        await verifyCaptcha(String(form.get("captchaVerifyParam") || ""));
        await enforceRateLimits(store, ipHash);

        const image = await validateImage(form.get("image"), {
            maxBytes: Number(process.env.MAX_IMAGE_BYTES || 5 * 1024 * 1024)
        });
        const exif = parseExif(String(form.get("exif") || ""));
        const prompts = buildPrompts(mode, exif);
        const result = await analyzeWithMoonshot({ image, ...prompts });
        const response = { rawContent: result.rawContent, model: result.model };
        await store.set(resultKey, response, RESULT_TTL_SECONDS);

        console.info(JSON.stringify({
            requestId,
            status: 200,
            durationMs: Date.now() - startedAt,
            model: result.model,
            imageBytes: image.buffer.length,
            imageWidth: image.width,
            imageHeight: image.height,
            deduplicated: false
        }));
        sendJson(res, 200, { ...response, requestId, deduplicated: false }, headers);
    } finally {
        await store.delete(lockKey);
    }
}

const server = http.createServer(async (req, res) => {
    let headers = {};
    try {
        headers = corsHeaders(req);
        if (req.method === "OPTIONS") {
            res.writeHead(204, headers);
            res.end();
            return;
        }
        if (req.method === "GET" && req.url === "/health") {
            sendJson(res, 200, { ok: true }, headers);
            return;
        }
        if (req.method !== "POST" || req.url !== "/api/analyze") {
            sendJson(res, 404, { code: "NOT_FOUND", message: "接口不存在" }, headers);
            return;
        }
        await handleAnalyze(req, res, headers);
    } catch (error) {
        const status = Number(error.status || 500);
        const code = error.code || "INTERNAL_ERROR";
        console.error(JSON.stringify({
            status,
            code,
            message: status >= 500 ? "internal error" : error.message
        }));
        if (!res.headersSent) {
            sendJson(res, status, {
                code,
                message: status >= 500 ? "服务暂时不可用，请稍后重试" : error.message
            }, headers);
        }
    }
});

const port = Number(process.env.PORT || 9000);
server.listen(port, "0.0.0.0", () => {
    console.info(`AI photo evaluator API listening on ${port}`);
});
