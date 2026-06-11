import Captcha20230305, * as captchaModels from "@alicloud/captcha20230305";
import * as OpenApi from "@alicloud/openapi-client";

let client;

function getClient(env) {
    if (client) return client;
    const config = new OpenApi.Config({
        accessKeyId: env.ALIBABA_CLOUD_ACCESS_KEY_ID,
        accessKeySecret: env.ALIBABA_CLOUD_ACCESS_KEY_SECRET
    });
    config.endpoint = env.ALIBABA_CAPTCHA_ENDPOINT || "captcha.cn-shanghai.aliyuncs.com";
    client = new Captcha20230305(config);
    return client;
}

export async function verifyCaptcha(captchaVerifyParam, env = process.env) {
    if (env.CAPTCHA_ENABLED !== "true") return;
    if (!captchaVerifyParam) {
        throw Object.assign(new Error("请先完成人机验证"), { code: "CAPTCHA_REQUIRED", status: 403 });
    }
    if (!env.ALIBABA_CAPTCHA_SCENE_ID || !env.ALIBABA_CLOUD_ACCESS_KEY_ID || !env.ALIBABA_CLOUD_ACCESS_KEY_SECRET) {
        throw new Error("验证码服务未正确配置");
    }

    const request = new captchaModels.VerifyIntelligentCaptchaRequest({
        captchaVerifyParam,
        sceneId: env.ALIBABA_CAPTCHA_SCENE_ID
    });
    const response = await getClient(env).verifyIntelligentCaptcha(request);
    if (!response?.body?.result?.verifyResult) {
        throw Object.assign(new Error("人机验证未通过，请重新验证"), { code: "CAPTCHA_FAILED", status: 403 });
    }
}
