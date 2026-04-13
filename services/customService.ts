import {
  CustomProvider,
  GeneratedImage,
  AspectRatioOption,
  RemoteModelList,
  RemoteModel,
} from "../types";
import { generateUUID } from "./utils";

const cleanUrl = (url: string) => url.replace(/\/+$/, "");

// Helper to transform flat model array to categorized list
export const transformModelList = (models: RemoteModel[]): RemoteModelList => {
  if (!Array.isArray(models)) return {};

  return {
    generate: models.filter((m) => m.type && m.type.includes("text2image")),
    edit: models.filter((m) => m.type && m.type.includes("image2image")),
    video: models.filter((m) => m.type && m.type.includes("image2video")),
    text: models.filter((m) => m.type && m.type.includes("text2text")),
    upscaler: models.filter((m) => m.type && m.type.includes("upscaler")),
  };
};

export const fetchServerModels = async (
  token?: string,
): Promise<RemoteModelList> => {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch("/api/v1/models", { headers });
  if (!response.ok) {
    if (response.status === 401) throw new Error("401");
    throw new Error("Failed to fetch server models");
  }
  const data = await response.json();
  return transformModelList(data);
};

export const generateCustomImage = async (
  provider: CustomProvider,
  model: string,
  prompt: string,
  aspectRatio: AspectRatioOption,
  seed?: number,
  steps?: number,
  guidance?: number,
  enableHD?: boolean,
): Promise<GeneratedImage> => {
  const baseUrl = cleanUrl(provider.apiUrl);
  const body = {
    model,
    prompt,
    ar: aspectRatio,
    seed: seed ?? Math.floor(Math.random() * 2147483647),
    steps,
    guidance,
    enableHD,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider.token) headers["Authorization"] = `Bearer ${provider.token}`;

  const response = await fetch(`${baseUrl}/v1/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  // Parse extended response fields
  // Structure: { id, url, width, height, seed, steps?, guidance? }
  const data = await response.json();
  const {
    id,
    url,
    seed: responseSeed,
    steps: responseSteps,
    guidance: responseGuidance,
  } = data;

  if (typeof url !== "string") {
    throw new Error(
      "Invalid response format from custom provider: URL not found",
    );
  }

  return {
    id: id || generateUUID(),
    url,
    model,
    prompt,
    aspectRatio, // Keeps requested AR for reference, though dimensions might differ slightly
    timestamp: Date.now(),
    seed: responseSeed !== undefined ? responseSeed : body.seed,
    steps: responseSteps !== undefined ? responseSteps : steps,
    guidanceScale: responseGuidance !== undefined ? responseGuidance : guidance,
    provider: provider.id, // Use custom provider ID
    // Note: GeneratedImage interface doesn't strictly enforce width/height properties on the root object
    // typically, but UI often derives them or uses them if available.
    // If needed, we can extend GeneratedImage type or rely on image onLoad in PreviewStage.
    // However, App.tsx uses `imageDimensions` state.
    // We will return them here, and update App.tsx to use them if we want to pre-fill dimensions.
  };
};

export const editImageCustom = async (
  provider: CustomProvider,
  model: string,
  imageBlobs: (string | Blob | File)[],
  prompt: string,
  seed?: number,
  steps?: number,
  guidance?: number,
): Promise<GeneratedImage> => {
  const baseUrl = cleanUrl(provider.apiUrl);
  const formData = new FormData();
  formData.append("model", model);
  formData.append("prompt", prompt);
  if (seed !== undefined) formData.append("seed", seed.toString());
  if (steps !== undefined) formData.append("steps", steps.toString());
  if (guidance !== undefined) formData.append("guidance", guidance.toString());

  imageBlobs.forEach((blob) => {
    formData.append("image", blob);
  });

  const headers: Record<string, string> = {};
  if (provider.token) headers["Authorization"] = `Bearer ${provider.token}`;

  const response = await fetch(`${baseUrl}/v1/edit`, {
    method: "POST",
    headers, // Do not set Content-Type, let browser set it with boundary
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  const { id, url } = await response.json();

  if (typeof url !== "string") {
    throw new Error(
      "Invalid response format from custom provider: URL not found",
    );
  }

  return {
    id: id || generateUUID(),
    url,
    model,
    prompt,
    aspectRatio: "custom",
    timestamp: Date.now(),
    seed,
    steps,
    provider: provider.id,
  };
};

export const generateCustomVideo = async (
  provider: CustomProvider,
  model: string,
  imageUrl: string,
  prompt: string,
  duration: number,
  seed: number,
  steps: number,
  guidance: number,
): Promise<{ url?: string; taskId?: string; predict?: number }> => {
  const baseUrl = cleanUrl(provider.apiUrl);
  const body = {
    model,
    imageUrl,
    prompt,
    duration,
    seed,
    steps,
    guidance,
  };

  const videoHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider.token) videoHeaders["Authorization"] = `Bearer ${provider.token}`;

  const response = await fetch(`${baseUrl}/v1/video`, {
    method: "POST",
    headers: videoHeaders,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  const data = await response.json();

  // Check for async task ID
  if (data.taskId) {
    return { taskId: data.taskId, predict: data.predict };
  }

  // Check for sync URL (string or object with url array or url string)
  if (typeof data === "string") {
    return { url: data };
  } else if (data.url) {
    return { url: data.url };
  }

  throw new Error("Video URL or Task ID not found in response");
};

export const getCustomTaskStatus = async (
  provider: CustomProvider,
  taskId: string,
): Promise<{ status: string; videoUrl?: string; error?: string }> => {
  const baseUrl = cleanUrl(provider.apiUrl);
  const headers: Record<string, string> = {};
  if (provider.token) {
    headers["Authorization"] = `Bearer ${provider.token}`;
  }

  try {
    const response = await fetch(`${baseUrl}/v1/task-status?taskId=${taskId}`, {
      method: "GET",
      headers,
    });

    if (!response.ok) throw new Error("Failed to check task status");

    const data = await response.json();
    // Expected data structure: { status: "success" | "failed", id?: string, url?: string | string[], error?: string }

    const result: { status: string; videoUrl?: string; error?: string } = {
      status: data.status || "processing",
    };

    if (data.status === "success" && data.url) {
      result.videoUrl = data.url;
    } else if (data.status === "failed") {
      result.error = data.error || "Video generation failed";
    }

    return result;
  } catch (error: any) {
    console.error("Check Custom Task Status Error:", error);
    return { status: "error", error: error.message };
  }
};

export const optimizePromptCustom = async (
  provider: CustomProvider,
  model: string,
  prompt: string,
): Promise<string> => {
  const baseUrl = cleanUrl(provider.apiUrl);
  const body = {
    model,
    prompt,
  };

  const textHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider.token) textHeaders["Authorization"] = `Bearer ${provider.token}`;

  const response = await fetch(`${baseUrl}/v1/text`, {
    method: "POST",
    headers: textHeaders,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  const { text } = await response.json();
  return text;
};

export const upscaleImageCustom = async (
  provider: CustomProvider,
  model: string,
  imageUrl: string,
): Promise<{ url: string }> => {
  const baseUrl = cleanUrl(provider.apiUrl);
  const body = {
    model,
    imageUrl,
  };

  const upscaleHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider.token) upscaleHeaders["Authorization"] = `Bearer ${provider.token}`;

  const response = await fetch(`${baseUrl}/v1/upscaler`, {
    method: "POST",
    headers: upscaleHeaders,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  const data = await response.json();

  if (!data.url) {
    throw new Error(
      "Invalid response format from custom upscaler: URL not found",
    );
  }

  return { url: data.url };
};
