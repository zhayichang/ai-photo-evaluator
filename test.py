import os
import json
import base64

from openai import OpenAI

# =====================================================
# Kimi Client
# =====================================================

client = OpenAI(
    api_key=os.environ.get("MOONSHOT_API_KEY"),
    base_url="https://api.moonshot.cn/v1",
)

# =====================================================
# Image Path
# =====================================================

IMAGE_PATH = "/Users/welkinzha/Desktop/Developing/photo-evaluation/1.png"

# =====================================================
# System Prompt
# =====================================================

SYSTEM_PROMPT = """
你是一名专业摄影评论家与视觉艺术导师。

请对摄影作品进行专业、严格、结构化分析。

要求：
1. 必须输出合法 JSON
2. 不允许输出 Markdown
3. 不允许输出 ```json
4. 不允许输出额外解释
5. 必须严格遵守 JSON 结构
6. 所有评分范围为 0-10
7. 分析必须具体专业
8. 不要空泛夸奖
9. 修改建议必须可执行

请使用专业摄影术语。

JSON结构如下：

{
  "photo_type": "",
  "photography_style": [],
  "overall_summary": "",

  "scores": {
    "composition": 0,
    "lighting": 0,
    "color": 0,
    "storytelling": 0,
    "post_processing": 0,
    "visual_impact": 0,
    "originality": 0,
    "overall": 0
  },

  "composition": {
    "analysis": "",
    "strengths": [],
    "problems": [],
    "suggestions": []
  },

  "lighting": {
    "analysis": "",
    "strengths": [],
    "problems": [],
    "suggestions": []
  },

  "color": {
    "analysis": "",
    "strengths": [],
    "problems": [],
    "suggestions": []
  },

  "storytelling": {
    "analysis": "",
    "strengths": [],
    "problems": [],
    "suggestions": []
  },

  "post_processing": {
    "analysis": "",
    "strengths": [],
    "problems": [],
    "suggestions": []
  },

  "advanced_analysis": {
    "visual_focus": "",
    "depth_and_layers": "",
    "visual_flow": "",
    "emotional_tone": "",
    "style_reference": [],
    "professional_potential": ""
  },

  "final_verdict": ""
}
"""

# =====================================================
# User Prompt
# =====================================================

USER_PROMPT = """
请对这张摄影作品进行完整专业评价。

重点分析：
- 构图
- 光线
- 色彩
- 情绪
- 叙事
- 后期处理
- 摄影风格
- 专业完成度

必须指出问题。
"""

# =====================================================
# Image -> Base64
# =====================================================

with open(IMAGE_PATH, "rb") as f:
    image_data = f.read()

ext = os.path.splitext(IMAGE_PATH)[1].lstrip(".").lower()

image_url = (
    f"data:image/{ext};base64,"
    f"{base64.b64encode(image_data).decode('utf-8')}"
)

# =====================================================
# API Request
# =====================================================

completion = client.chat.completions.create(
    model="kimi-k2.6",
    temperature=1,

    # 非常重要：强制 JSON
    response_format={"type": "json_object"},

    messages=[
        {
            "role": "system",
            "content": SYSTEM_PROMPT
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": image_url
                    }
                },
                {
                    "type": "text",
                    "text": USER_PROMPT
                }
            ]
        }
    ]
)

# =====================================================
# Parse JSON
# =====================================================

raw_content = completion.choices[0].message.content

try:
    result = json.loads(raw_content)

except json.JSONDecodeError:
    print("JSON解析失败：")
    print(raw_content)
    exit()

# =====================================================
# Pretty Print
# =====================================================

print("\n" + "=" * 80)
print("AI 摄影评价（JSON结构化输出）")
print("=" * 80 + "\n")

print(json.dumps(result, indent=2, ensure_ascii=False))

# =====================================================
# Example Access
# =====================================================

print("\n" + "=" * 80)
print("示例字段读取")
print("=" * 80)

print("\n照片类型：")
print(result["photo_type"])

print("\n摄影风格：")
print(result["photography_style"])

print("\n总体评分：")
print(result["scores"]["overall"])

print("\n构图分析：")
print(result["composition"]["analysis"])

print("\n最终评价：")
print(result["final_verdict"])