// =========================================
// Utils: file conversions, animations, helpers
// =========================================

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
    });
}

function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;

            if (width > maxWidth || height > maxWidth) {
                if (width > height) {
                    height = Math.round(height * maxWidth / width);
                    width = maxWidth;
                } else {
                    width = Math.round(width * maxWidth / height);
                    height = maxWidth;
                }
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);

            const dataUrl = canvas.toDataURL("image/jpeg", quality);
            resolve(dataUrl);
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("图片加载失败"));
        };

        img.src = url;
    });
}

function dataUrlToFile(dataUrl, filename) {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
}

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

function renderListSection(title, items = []) {
    if (!items.length) return "";
    return `
        <div class="analysis-section">
            <h4>${title}</h4>
            <ul>
                ${items.map(item => `<li>${item}</li>`).join("")}
            </ul>
        </div>
    `;
}

function startFakeProgress() {
    const bar = document.getElementById("loadingProgress");
    bar.style.width = "0%";
    bar.style.transition = "width 0.8s cubic-bezier(0.22, 1, 0.36, 1)";

    setTimeout(() => bar.style.width = "15%", 300);

    let progress = 15;
    loadingProgressInterval = setInterval(() => {
        if (progress < 90) {
            progress += Math.random() * 5 + 2;
            if (progress > 90) progress = 90;
            bar.style.width = progress + "%";
        }
    }, 8000);
}

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

function stopLoadingAnimation() {
    clearInterval(loadingStageInterval);
    clearInterval(loadingProgressInterval);

    const bar = document.getElementById("loadingProgress");
    bar.style.transition = "width 0.3s ease";
    bar.style.width = "100%";

    setTimeout(() => {
        bar.style.width = "0%";
    }, 500);
}
