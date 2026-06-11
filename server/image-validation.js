const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function jpegDimensions(buffer) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) return null;
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
            return {
                height: buffer.readUInt16BE(offset + 5),
                width: buffer.readUInt16BE(offset + 7)
            };
        }
        if (length < 2) return null;
        offset += 2 + length;
    }
    return null;
}

function pngDimensions(buffer) {
    if (buffer.length < 24) return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function webpDimensions(buffer) {
    if (buffer.length < 30) return null;
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
        return {
            width: 1 + buffer.readUIntLE(24, 3),
            height: 1 + buffer.readUIntLE(27, 3)
        };
    }
    if (chunk === "VP8L") {
        const bits = buffer.readUInt32LE(21);
        return {
            width: (bits & 0x3fff) + 1,
            height: ((bits >> 14) & 0x3fff) + 1
        };
    }
    if (chunk === "VP8 " && buffer.length >= 30) {
        return {
            width: buffer.readUInt16LE(26) & 0x3fff,
            height: buffer.readUInt16LE(28) & 0x3fff
        };
    }
    return null;
}

function detectImage(buffer) {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return { mime: "image/jpeg", dimensions: jpegDimensions(buffer) };
    }
    if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        return { mime: "image/png", dimensions: pngDimensions(buffer) };
    }
    if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
        return { mime: "image/webp", dimensions: webpDimensions(buffer) };
    }
    return null;
}

export function validateImage(file, options = {}) {
    const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
    const maxDimension = options.maxDimension ?? 12000;
    if (!file || typeof file.arrayBuffer !== "function") {
        throw Object.assign(new Error("缺少图片文件"), { code: "INVALID_IMAGE", status: 400 });
    }
    if (!ALLOWED_MIME.has(file.type)) {
        throw Object.assign(new Error("仅支持 JPG、PNG 和 WebP"), { code: "INVALID_IMAGE_TYPE", status: 415 });
    }
    if (file.size <= 0 || file.size > maxBytes) {
        throw Object.assign(new Error("图片超过 5MB 上传限制"), { code: "PAYLOAD_TOO_LARGE", status: 413 });
    }
    return file.arrayBuffer().then((arrayBuffer) => {
        const buffer = Buffer.from(arrayBuffer);
        const detected = detectImage(buffer);
        if (!detected || detected.mime !== file.type || !detected.dimensions) {
            throw Object.assign(new Error("图片格式与文件内容不一致"), { code: "INVALID_IMAGE_SIGNATURE", status: 415 });
        }
        const { width, height } = detected.dimensions;
        if (width <= 0 || height <= 0 || width > maxDimension || height > maxDimension || width * height > 60_000_000) {
            throw Object.assign(new Error("图片尺寸不在允许范围内"), { code: "INVALID_IMAGE_DIMENSIONS", status: 413 });
        }
        return { buffer, mime: detected.mime, width, height };
    });
}
