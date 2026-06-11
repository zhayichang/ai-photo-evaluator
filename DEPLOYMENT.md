# 中国大陆部署说明

## 架构

- `index.html`、`style.css`、`script.js` 部署到阿里云 OSS，并通过已备案域名的 CDN 分发。
- `/api/analyze` 转发到同地域的阿里云函数计算。
- 函数计算通过公网 HTTPS 调用 Moonshot，浏览器不会接触 API Key。
- Redis 用于跨实例限流、短时间请求锁和结果去重。

## 上线前准备

1. 撤销曾提交到 Git 的 Moonshot Key，并检查历史用量。
2. 创建新的 Moonshot Key，只配置到函数计算环境变量 `MOONSHOT_API_KEY`。
3. 创建阿里云 Redis，并配置内网地址 `REDIS_URL`。
4. 生成至少 32 字节随机值配置为 `IP_HASH_SALT`，Redis 中只保存网络地址哈希。
5. 完成域名 ICP 备案，将 CDN 的 `/api/*` 回源到函数计算自定义域名。
6. 将 `ALLOWED_ORIGINS` 设置为正式 HTTPS 域名，不要使用 `*`。
7. 限制函数计算默认公网地址的直接访问，仅允许备案域名/CDN 回源，并确保网关覆盖而不是透传客户端伪造的 `X-Forwarded-For`。

生产环境缺少 `REDIS_URL` 时服务会拒绝启动，防止多实例部署后限流失效。

## 环境变量

以 [.env.example](./.env.example) 为清单。在函数计算控制台配置敏感值，不要写入 `s.yaml`、前端文件或 CI 日志。

函数超时必须不低于 240 秒，请求体限制至少 8MB。图片本身仍限制为 5MB，额外空间用于 multipart 边界和 EXIF 字段。

## 阿里云验证码 2.0

服务端已经使用阿里云官方 SDK 调用 `VerifyIntelligentCaptcha`。启用步骤：

1. 创建验证码场景，配置 `ALIBABA_CAPTCHA_SCENE_ID`。
2. 使用只具备验证码核验权限的 RAM 用户配置 AccessKey。
3. 前端按阿里云验证码 2.0 文档初始化组件，在验证成功回调中调用：

```js
window.setPhotoEvaluatorCaptcha(captchaVerifyParam);
```

4. 完成前端联调后设置 `CAPTCHA_ENABLED=true`。在此之前保持为 `false`，否则所有请求都会被拒绝。

## 本地联调

```bash
cp .env.example .env
npm install
npm start
```

静态页面可运行在 `http://127.0.0.1:4173`。本地反向代理需将 `/api` 指向 `http://127.0.0.1:9000`。

## 监控

日志只包含请求 ID、状态码、耗时、模型、图片字节数和尺寸。不要记录请求体、Base64、Authorization、完整 EXIF 或模型提示词。

上线后分别用移动、联通、电信及移动网络完成至少 20 次真实请求，统计上传耗时、AI 耗时、成功率和 P95。
