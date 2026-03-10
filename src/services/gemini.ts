import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

// 辅助函数：获取 Gemini 实例
// 注意：对于需要用户选择 Key 的模型（如 gemini-3.1-flash-image-preview），
// 必须在调用前动态创建实例以确保使用最新的 Key。
export const getGeminiClient = (apiKey?: string) => {
  const key = apiKey || import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  return new GoogleGenAI({ apiKey: key });
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
- **description (中文)**：极其生动、具有电影感的画面描述。不仅描述物体，还要描述**氛围、光影和情绪**（例如：阳光穿过指缝的温暖、显微镜下细胞跳动的生命感）。
- **prompt (英文)**：高水准的 AI 绘图提示词。
  - **风格统一**：Professional medical 3D rendering, Octane Render, 8k, cinematic lighting.
  - **细节丰富**：包含构图（Extreme close-up, Bird's eye view）、光影（Volumetric lighting, Soft bokeh）、材质（Translucent skin, Metallic medical tools）。
  - **情感化**：通过色彩和构图传达治愈、专业或警示的情绪。

请以 JSON 格式返回。`;

  console.log("正在请求 Gemini 生成文案，主题:", topic);

  try {
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

    // 清洗可能的 Markdown 标记并解析
    const rawText = response.text || "{}";
    const cleanJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    const data = JSON.parse(cleanJson);
    console.log("文案生成成功:", data);

    onProgress?.('正在规划视觉分镜与绘图指令...');
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
  } catch (error) {
    console.error("Gemini API 调用失败:", error);
    throw error;
  }
}

// 生成分镜图片
export async function generateStoryboardImage(prompt: string): Promise<string> {
  // 必须重新创建实例以使用用户选择的 API Key
  const ai = getGeminiClient(process.env.API_KEY);
  
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-image-preview',
    contents: {
      parts: [{ text: `Medical illustration style, professional, clean, high quality: ${prompt}` }],
    },
    config: {
      imageConfig: {
        aspectRatio: "16:9",
        imageSize: "1K"
      }
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  
  throw new Error("未能生成图片");
}
