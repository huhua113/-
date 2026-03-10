import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

// 辅助函数：获取 Gemini 实例
// 注意：对于需要用户选择 Key 的模型（如 gemini-3.1-flash-image-preview），
// 必须在调用前动态创建实例以确保使用最新的 Key。
export const getGeminiClient = (apiKey?: string) => {
  const key = apiKey || 
              (import.meta.env.VITE_GEMINI_API_KEY && import.meta.env.VITE_GEMINI_API_KEY.trim() !== "" ? import.meta.env.VITE_GEMINI_API_KEY : undefined) || 
              process.env.GEMINI_API_KEY;
  
  if (!key) {
    console.warn(">>> [Gemini] 未找到 API Key，可能会导致请求失败。");
  }
  return new GoogleGenAI({ apiKey: key || "" });
};

export interface Storyboard {
  id: number;
  description: string;
  prompt: string;
  imageUrl?: string;
  isGenerating?: boolean;
}

export interface GenerationResult {
  script: string;
  storyboards: Storyboard[];
  sources?: { uri: string; title: string }[];
}

// 生成科普文案
export async function generateMedicalScript(
  topic: string, 
  onProgress?: (status: string) => void
): Promise<GenerationResult> {
  const ai = getGeminiClient();
  
  onProgress?.('正在检索医学文献与生成文案...');
  const prompt = `你是一名资深的医学科普专家和顶级短视频视觉导演。请针对题目“${topic}”生成一段适合抖音/小红书的短视频科普文案及配套的9个视觉分镜。

### 1. 科普文案要求：
- **专业性与严谨性**：基于公认的医学事实、研究或最新的临床指南。
- **情感共鸣**：开头必须通过描述患者真实的**痛点、症状或心理挣扎**（如：深夜的焦虑、反复的病痛）来抓住观众。
- **通俗化**：将深奥的医学逻辑转化为生活化的比喻，字数600字左右。
- **结构**：【痛点引入】→【深度科普】→【误区纠正】→【行动建议】。

### 2. 视觉分镜要求（9个）：
- **description (中文)**：极其生动、具有电影感的画面描述。不仅描述物体，还要描述氛围、光影和情绪。
- **prompt (英文)**：必须结构化，严格按照以下格式输出：
  - **Style (风格)**: e.g., Professional medical 3D rendering, Octane Render, 8k, cinematic lighting.
  - **Scene (场景)**: e.g., Modern hospital room, microscopic view of cells.
  - **Camera (镜头)**: e.g., Extreme close-up, Bird's eye view, Wide shot.
  - **Emotion (情绪)**: e.g., Healing, Professional, Urgent, Calm.
  - **Subject (主体)**: e.g., Doctor, Patient, DNA strand.
  - **Action (主体动作)**: e.g., Examining, Pointing, Explaining.
  (请将以上要素合并为一段连贯的英文提示词)

请以 JSON 格式返回。`;

  console.log("正在请求 Gemini 生成文案，主题:", topic);

  try {
    console.log(">>> [Gemini] 正在调用 generateContent...");
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            script: { type: Type.STRING },
            storyboard_prompts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  description: { type: Type.STRING },
                  prompt: { type: Type.STRING }
                },
                required: ["description", "prompt"]
              }
            }
          },
          required: ["script", "storyboard_prompts"]
        }
      }
    });

    console.log(">>> [Gemini] 收到响应:", response);

    const rawText = response.text;
    if (!rawText) {
      throw new Error("模型返回了空响应");
    }

    // 清洗可能的 Markdown 标记并解析
    const cleanJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    const data = JSON.parse(cleanJson);
    console.log(">>> [Gemini] 解析成功:", data);

    onProgress?.('正在整理分镜与参考资料...');
    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.filter(chunk => chunk.web)
      .map(chunk => ({ uri: chunk.web!.uri, title: chunk.web!.title || "参考来源" }));

    return {
      script: data.script,
      storyboards: (data.storyboard_prompts || []).map((item: any, index: number) => ({
        id: index + 1,
        description: item.description,
        prompt: item.prompt
      })),
      sources
    };
  } catch (error: any) {
    console.error(">>> [Gemini] 生成失败:", error);
    throw error;
  }
}

// 生成分镜图片
export async function generateStoryboardImage(prompt: string): Promise<string> {
  // 优先使用 getGeminiClient 的默认逻辑（包含环境变量检查）
  const ai = getGeminiClient();
  
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-image-preview', // 使用 Nano Banana 2
    contents: {
      parts: [{ text: `Medical illustration style, professional, clean, high quality, 9:16 aspect ratio: ${prompt}` }],
    },
    config: {
      // imageConfig removed to fix potential generation issue
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  
  throw new Error("未能生成图片");
}
