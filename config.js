window.APP_CONFIG = {
    apiEndpoint: ["localhost", "127.0.0.1"].includes(window.location.hostname) || window.location.protocol === "file:"
        ? "http://127.0.0.1:9000/api/analyze"
        : "https://photo-eator-api-htmyliwsyn.cn-hangzhou.fcapp.run/api/analyze"
};
