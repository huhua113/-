export async function generateDoubaoImage(prompt: string): Promise<string> {
  const apiKey = import.meta.env.VITE_DOUBAO_API_KEY;
  if (!apiKey) {
    throw new Error("未配置豆包 API Key");
  }

  // 这是一个示例端点，请根据实际的豆包/火山引擎 API 文档进行调整
  const response = await fetch("https://api.volcengine.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "doubao-image-model", // 请替换为实际的模型名称
      prompt: `Medical illustration style, professional, clean, high quality, 9:16 aspect ratio: ${prompt}`,
      size: "1024x1792", // 9:16 比例
    }),
  });

  if (!response.ok) {
    throw new Error(`豆包 API 请求失败: ${response.statusText}`);
  }

  const data = await response.json();
  // 假设返回结构为 { data: [{ url: "..." }] }
  if (data.data && data.data[0] && data.data[0].url) {
    return data.data[0].url;
  }

  throw new Error("未能从豆包 API 获取图片");
}
