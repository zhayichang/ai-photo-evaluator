// =========================================
// EXIF 解析与展示
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

// EXIF 展示卡片（上传后本地显示）
function renderExifCard(exif) {
    // 无论有没有数据，先清理旧卡片
    let existing = document.getElementById("exifDisplayCard");
    if (existing) existing.remove();

    // 没有有效数据就不创建新卡片
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
