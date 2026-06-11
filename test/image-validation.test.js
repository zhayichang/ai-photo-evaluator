import test from "node:test";
import assert from "node:assert/strict";
import { validateImage } from "../server/image-validation.js";

function pngFile(width = 640, height = 480, type = "image/png") {
    const buffer = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer, 0);
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return new File([buffer], "photo.png", { type });
}

test("accepts an image whose MIME, signature and dimensions agree", async () => {
    const image = await validateImage(pngFile());
    assert.equal(image.mime, "image/png");
    assert.equal(image.width, 640);
    assert.equal(image.height, 480);
});

test("rejects a forged MIME type", async () => {
    await assert.rejects(
        validateImage(pngFile(640, 480, "image/jpeg")),
        (error) => error.code === "INVALID_IMAGE_SIGNATURE" && error.status === 415
    );
});

test("rejects excessive dimensions", async () => {
    await assert.rejects(
        validateImage(pngFile(20000, 100)),
        (error) => error.code === "INVALID_IMAGE_DIMENSIONS" && error.status === 413
    );
});
