import { CustomProvider, ServiceMode, VideoSettings } from "../types";
import { useConfigStore } from "../store/configStore";

export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// --- Date Helpers for Token Rotation ---

export const getUTCDatesString = () => new Date().toISOString().split("T")[0];

export const getBeijingDateString = () => {
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const nd = new Date(utc + 3600000 * 8);
  return nd.toISOString().split("T")[0];
};

// --- Service Mode Management ---

export const getServiceMode = (): ServiceMode => {
  return useConfigStore.getState().serviceMode;
};

export const saveServiceMode = (mode: ServiceMode) => {
  useConfigStore.getState().setServiceMode(mode);
};

// --- System Prompt Management ---

export const FIXED_SYSTEM_PROMPT_SUFFIX =
  "\nEnsure the output language matches the language of user's prompt that needs to be optimized.";

// Re-export from configStore as the single source of truth
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_SYSTEM_PROMPT_CONTENT } from "../store/configStore";

export const DEFAULT_TRANSLATION_SYSTEM_PROMPT = `You are a professional language translation engine.
Your sole responsibility is to translate user-provided text into English. Before processing any input, you must first identify its original language.
If the input text is already in English, return the original English text directly without any modification. If the input text is not in English, translate it precisely into English.
Your output must strictly adhere to the following requirements: it must contain only the final English translation or the original English text, without any explanations, comments, descriptions, prefixes, suffixes, quotation marks, or other non-translated content.`;

export const getSystemPromptContent = (): string => {
  return useConfigStore.getState().systemPrompt;
};

export const saveSystemPromptContent = (content: string) => {
  useConfigStore.getState().setSystemPrompt(content);
};

export const getTranslationPromptContent = (): string => {
  return useConfigStore.getState().translationPrompt;
};

export const saveTranslationPromptContent = (content: string) => {
  useConfigStore.getState().setTranslationPrompt(content);
};

// --- Unified Model Configuration ---

export const getEditModelConfig = (): { provider: string; model: string } => {
  return useConfigStore.getState().editModelConfig;
};

export const saveEditModelConfig = (value: string) => {
  const [provider, model] = value.split(":");
  if (provider && model) {
    useConfigStore.getState().setEditModelConfig({ provider, model });
  }
};

export const getLiveModelConfig = (): { provider: string; model: string } => {
  return useConfigStore.getState().liveModelConfig;
};

export const saveLiveModelConfig = (value: string) => {
  const [provider, model] = value.split(":");
  if (provider && model) {
    useConfigStore.getState().setLiveModelConfig({ provider, model });
  }
};

export const getTextModelConfig = (): { provider: string; model: string } => {
  return useConfigStore.getState().textModelConfig;
};

export const saveTextModelConfig = (value: string) => {
  const [provider, model] = value.split(":");
  if (provider && model) {
    useConfigStore.getState().setTextModelConfig({ provider, model });
  }
};

export const getUpscalerModelConfig = (): {
  provider: string;
  model: string;
} => {
  return useConfigStore.getState().upscalerModelConfig;
};

export const saveUpscalerModelConfig = (value: string) => {
  const [provider, model] = value.split(":");
  if (provider && model) {
    useConfigStore.getState().setUpscalerModelConfig({ provider, model });
  }
};

// --- Video Settings Management ---

export const DEFAULT_VIDEO_SETTINGS: Record<string, VideoSettings> = {
  huggingface: {
    prompt: "make this image come alive, cinematic motion, smooth animation",
    duration: 3,
    steps: 6,
    guidance: 1,
  },
  gitee: {
    prompt: "make this image come alive, cinematic motion, smooth animation",
    duration: 3,
    steps: 10,
    guidance: 4,
  },
  modelscope: {
    prompt: "make this image come alive, cinematic motion, smooth animation",
    duration: 3,
    steps: 10,
    guidance: 4,
  },
  a4f: {
    prompt: "make this image come alive, cinematic motion, smooth animation",
    duration: 3,
    steps: 10,
    guidance: 4,
  },
};

export const getVideoSettings = (provider: string): VideoSettings => {
  const storeSettings = useConfigStore.getState().videoSettings;
  const defaults =
    DEFAULT_VIDEO_SETTINGS[provider] || DEFAULT_VIDEO_SETTINGS["huggingface"];
  const userSettings = storeSettings[provider];

  if (!userSettings) return defaults;
  return { ...defaults, ...userSettings };
};

export const saveVideoSettings = (
  provider: string,
  settings: VideoSettings,
) => {
  useConfigStore.getState().setVideoSettings(provider, settings);
};

// --- Custom Provider Management ---

export const getCustomProviders = (): CustomProvider[] => {
  return useConfigStore.getState().customProviders;
};

export const saveCustomProviders = (providers: CustomProvider[]) => {
  useConfigStore.getState().setCustomProviders(providers);
};

export const addCustomProvider = (provider: CustomProvider) => {
  useConfigStore.getState().addCustomProvider(provider);
};

export const removeCustomProvider = (id: string) => {
  useConfigStore.getState().removeCustomProvider(id);
};

// --- Translation Service ---

const POLLINATIONS_API_URL = "https://text.pollinations.ai/openai";

export const translatePrompt = async (text: string): Promise<string> => {
  try {
    const systemPrompt = getTranslationPromptContent();

    const response = await fetch(POLLINATIONS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai-fast",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: text,
          },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error("Translation request failed");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    return content || text;
  } catch (error) {
    console.error("Translation Error:", error);
    throw Object.assign(new Error("error_translation_failed"), {
      cause: error,
    });
  }
};

export const optimizeEditPrompt = async (
  imageBase64: string,
  prompt: string,
  model: string = "openai-fast",
): Promise<string> => {
  try {
    // Pollinations AI OpenAI-compatible endpoint
    const response = await fetch(POLLINATIONS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model, // Dynamically use passed model
        messages: [
          {
            role: "system",
            content: `You are a professional AI image editing assistant.
Your task is to analyze the image provided by the user (which may include user-drawn masks/indicated editing areas) and the user's text request, and deeply understand their intent.
When analyzing the image, you must actively extract and integrate its inherent visual context, including but not limited to the image subject, existing elements, color scheme, lighting conditions, and overall atmosphere, ensuring seamless integration with the optimized editing instructions.
Based on the visual context and text, optimize the user's editing instructions into more precise, descriptive prompts that are easier for the AI model to understand.
When the user's request is vague or incomplete, intelligently infer and supplement specific, reasonable visual details to refine the editing instructions.
When generating optimized prompts, be sure to clearly incorporate descriptions of the expected visual changes, prioritizing the addition of detailed visual styles, precise lighting conditions, reasonable compositional layouts, and specific material textures to ensure the AI model can accurately understand and execute the instructions.
For example: 'Replace the masked area with [specific object], emphasizing its [material], [color], and [lighting effect]', 'Add a [new object] at [specified location], giving it a [specific style] and [compositional relationship]', or 'Adjust the overall image style to [artistic style], keeping [original elements] unchanged, but enhancing [a certain feature]'.
Keep the generated prompts concise and descriptive, prioritizing the use of descriptive keywords and phrases that are easier for AI image models to understand and respond to, to maximize the effectiveness and accuracy of the prompt execution.
Only reply with the optimized prompt text. Do not add any conversational content. Do not include any markdown syntax. Ensure the output language matches the language of the prompt that needs to be optimized.`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageBase64 } },
            ],
          },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to optimize prompt");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    return content || prompt;
  } catch (error) {
    console.error("Optimize Edit Prompt Error:", error);
    throw error;
  }
};

// --- Unified URL/Blob Utilities ---

const DEFAULT_PROXY_URL = "https://peinture-proxy.9th.xyz/";

export const getProxyUrl = (url: string) => {
  const proxyBase = (import.meta.env.VITE_PROXY_URL || DEFAULT_PROXY_URL).replace(/\/$/, "");
  return `${proxyBase}/?url=${encodeURIComponent(url)}`;
};

/**
 * Unified function to fetch a Blob from a URL.
 * First tries a direct fetch. If that fails (e.g. CORS), falls back to using the proxy.
 */
export const fetchBlob = async (url: string): Promise<Blob> => {
  // Handle data/blob URLs locally without fetching
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Local fetch failed: ${res.status}`);
      return res.blob();
    } catch (e) {
      console.warn("Local blob/data URL fetch failed", e);
      throw Object.assign(new Error("Local resource not found"), { cause: e });
    }
  }

  try {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok)
      throw new Error(`Direct fetch failed: ${response.status}`);
    return await response.blob();
  } catch (e) {
    console.warn("Direct fetch failed, trying proxy...", e);
    const proxyUrl = getProxyUrl(url);
    const proxyResponse = await fetch(proxyUrl);
    if (!proxyResponse.ok)
      throw Object.assign(
        new Error(`Proxy fetch failed: ${proxyResponse.status}`),
        { cause: e },
      );
    return await proxyResponse.blob();
  }
};

/**
 * Unified function to download an image from a URL.
 * - Non-mobile:
 *   - If local (blob/data) or remote: creates <a> tag to download.
 * - Mobile:
 *   - If local: Fetch Blob -> Share -> Fallback to ObjectURL download.
 *   - If remote: Creates <a> tag (direct download).
 * - Fallback: window.open
 */
export const downloadImage = async (url: string, fileName: string) => {
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    );
  const isLocal = url.startsWith("blob:") || url.startsWith("data:");

  // Helper to trigger download via anchor tag
  const triggerAnchorDownload = (href: string, name: string) => {
    const link = document.createElement("a");
    link.href = href;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isMobile && isLocal) {
    let downloadUrl: string | null = null;
    try {
      const blob = await fetchBlob(url);
      const file = new File([blob], fileName, { type: blob.type });
      const nav = navigator as any;

      // 1. Try Share
      if (nav.canShare && nav.canShare({ files: [file] })) {
        try {
          await nav.share({
            files: [file],
            title: "Peinture Image",
          });
          return; // Share successful
        } catch (e: any) {
          if (e.name === "AbortError") return; // User cancelled
          console.warn("Share failed, falling back to download", e);
        }
      }

      // 2. Fallback to ObjectURL Download
      downloadUrl = URL.createObjectURL(blob);
      triggerAnchorDownload(downloadUrl, fileName);

      // Cleanup
      setTimeout(() => {
        if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      }, 1000);
    } catch (e) {
      console.error("Mobile local download failed", e);
      // 3. Final Fallback: Window Open
      const target = downloadUrl || url;
      window.open(target, "_blank");
      if (downloadUrl) {
        setTimeout(() => URL.revokeObjectURL(downloadUrl!), 1000);
      }
    }
  } else {
    // Desktop or Mobile Remote
    try {
      triggerAnchorDownload(url, fileName);
    } catch (e) {
      console.error("Download failed", e);
      window.open(url, "_blank");
    }
  }
};

export const getExtensionFromUrl = (url: string): string | null => {
  let path = url;
  try {
    const urlObj = new URL(url);
    path = urlObj.pathname;
  } catch {
    /* ignore */
  }

  if (url.includes("gradio_api/file=")) {
    const parts = url.split("gradio_api/file=");
    if (parts.length > 1) path = parts[1];
  }
  path = path.split("?")[0];
  const match = path.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1] : null;
};

/**
 * Convert a Blob to PNG format using canvas.
 */
export const convertBlobToPng = (blob: Blob): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Canvas context not available"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((pngBlob) => {
        URL.revokeObjectURL(url);
        if (pngBlob) resolve(pngBlob);
        else reject(new Error("PNG conversion failed"));
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed during conversion"));
    };
    img.src = url;
  });
};

/**
 * Add a prompt to session storage history (for autocomplete/suggestions).
 * Keeps most recent 50 entries, deduplicates.
 */
export const addToPromptHistory = (text: string): void => {
  const trimmed = text.trim();
  if (!trimmed) return;

  let currentHistory: string[] = [];
  try {
    const saved = sessionStorage.getItem("prompt_history");
    currentHistory = saved ? JSON.parse(saved) : [];
  } catch {
    /* ignore */
  }

  const filtered = currentHistory.filter((p) => p !== trimmed);
  const newHistory = [trimmed, ...filtered].slice(0, 50);

  sessionStorage.setItem("prompt_history", JSON.stringify(newHistory));
};
