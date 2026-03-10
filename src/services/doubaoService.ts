export async function generateDoubaoImage(prompt: string): Promise<string> {
  const apiKey = import.meta.env.VITE_DOUBAO_API_KEY;
  if (!apiKey) {
    throw new Error("未配置豆包 API Key");
  }

  console.log(">>> [Doubao] 正在调用 API，Prompt:", prompt);
  const response = await fetch("https://api.volcengine.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gemini-2.5-flash-image", // 已改回 nano banana 模型
      prompt: `Medical illustration style, professional, clean, high quality, 9:16 aspect ratio: ${prompt}`,
      size: "1024x1792", // 9:16 比例
    }),
  });

  const data = await response.json();
  console.log(">>> [Doubao] 收到响应:", data);

  if (!response.ok) {
    throw new Error(`豆包 API 请求失败: ${response.statusText}, 详情: ${JSON.stringify(data)}`);
  }
  // 假设返回结构为 { data: [{ url: "..." }] }
  if (data.data && data.data[0] && data.data[0].url) {
    return data.data[0].url;
  }

  throw new Error("未能从豆包 API 获取图片");
}
