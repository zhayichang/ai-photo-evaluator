# 部署与维护

本项目由两部分组成：

- 前端部署在 GitHub Pages。
- Node.js API 部署在阿里云函数计算，负责保管 Moonshot API Key 并转发分析请求。

## 前端更新

修改 `index.html`、`style.css`、`script.js` 或 `config.js` 后，将代码合并到 `main`。GitHub Pages 会自动更新。

`config.js` 只包含公开的函数地址，不应存放任何密钥。

## 后端更新

修改 `server/` 后，需要重新打包并在阿里云函数计算控制台上传：

```bash
npm install
zip -r server-deploy.zip server package.json package-lock.json node_modules \
  -x '*/.DS_Store' '*/__MACOSX/*'
```

函数配置：

```text
运行环境：Node.js 20 自定义运行时
启动命令：npm start
监听端口：9000
执行超时：240 秒
```

上传后可访问 `/health`，返回 `{"ok":true}` 表示部署成功。

## 环境变量

完整清单参见 [.env.example](./.env.example)。真实值只配置在阿里云控制台，尤其不要提交：

- `MOONSHOT_API_KEY`
- `IP_HASH_SALT`
- Redis 密码
- 阿里云 AccessKey Secret

更换 Moonshot Key 时只需修改阿里云环境变量，无需修改代码或重新上传 ZIP。

当前小范围使用可保持：

```text
NODE_ENV=development
CAPTCHA_ENABLED=false
```

准备公开推广前，应配置 Redis、验证码和费用预警。
