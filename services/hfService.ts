import { GeneratedImage, AspectRatioOption, ModelOption } from "../types";
import { getDimensions } from "./dimensions";
import {
  generateUUID,
  getSystemPromptContent,
  FIXED_SYSTEM_PROMPT_SUFFIX,
  getVideoSettings,
  fetchBlob,
} from "./utils";
import { fetchCloudBlob } from "./storageService";
import { API_MODEL_MAP } from "../constants";

import { runWithTokenRetry } from "./tokenRetry";

const ZIMAGE_BASE_API_URL = "https://laruss5-z-image-turbo.hf.space";
//const ZIMAGE_BASE_API_URL = "https://mrfakename-z-image-turbo.hf.space";
const ZIMAGE_MODEL_BASE_API_URL = "https://mrfakename-z-image.hf.space";
const QWEN_IMAGE_BASE_API_URL = "https://mcp-tools-qwen-image-fast.hf.space";
const QWEN_IMAGE_EDIT_BASE_API_URL =
  "https://ivan1617-qwen-image-edit-plus-nsfw-demo.hf.space";
const QWEN_IMAGE_21_BASE_API_URL =
  "https://assembledchaos-qwen-image-2-1-studio.hf.space";
const QWEN_IMAGE_21_PROMPT_ENHANCER_URL =
  "https://hugging-apps-qwen-image-2-1-prompt-enhancer.hf.space";
const OVIS_IMAGE_BASE_API_URL = "https://aidc-ai-ovis-image-7b.hf.space";
const FLUX_SCHNELL_BASE_API_URL =
  "https://black-forest-labs-flux-1-schnell.hf.space";
const UPSCALER_BASE_API_URL = "https://phips-upscaler.hf.space";
//const UPSCALER_BASE_API_URL = "https://tuan2308-upscaler.hf.space";
const POLLINATIONS_API_URL = "https://text.pollinations.ai/openai";
const WAN2_VIDEO_API_URL = "https://observantdistressed-wan2-2-i2v-v3.hf.space";
//const WAN2_VIDEO_API_URL = "https://fradeck619-wan2-2-fp8da-aoti-faster.hf.space";

const Z_IMAGE_NEGATIVE_PROMPT =
  "worst quality, low quality, JPEG compression artifacts, ugly, incomplete, extra fingers, poorly drawn hands, poorly drawn face, deformed, disfigured, malformed limbs, fused fingers, cluttered background, three legs";

const QUOTA_ERROR_KEY = "error_quota_exhausted";

// Token retry delegates to shared service
const runWithHFTokenRetry = <T>(
  operation: (token: string | null) => Promise<T>,
): Promise<T> => {
  return runWithTokenRetry("huggingface", operation);
};

// Gradio 5.x Spaces serve files via absolute URLs; Gradio 4.x / self-hosted
// Spaces may return relative paths like "/file=..." or "/gradio_api/file=..."
const normalizeSpaceUrl = (
  baseUrl: string,
  url?: string | null,
): string => {
  if (!url || typeof url !== "string") return "";
  if (
    /^https?:\/\//.test(url) ||
    url.startsWith("data:") ||
    url.startsWith("blob:")
  ) {
    return url;
  }
  if (url.startsWith("/")) return `${baseUrl}${url}`;
  return url;
};

// Free HF Spaces sleep after inactivity; the first request to a sleeping
// Space returns 503 while it boots. Poll /config (available on Gradio 4 & 5)
// until the Space is awake, mirroring the official Gradio client behaviour.
const spaceAwakeCache = new Map<string, number>();
const AWAKE_CACHE_MS = 60_000;

const ensureSpaceAwake = async (
  baseUrl: string,
  token?: string | null,
  signal?: AbortSignal,
): Promise<void> => {
  const now = Date.now();
  const cached = spaceAwakeCache.get(baseUrl);
  if (cached && now - cached < AWAKE_CACHE_MS) return;

  const deadline = now + 180_000; // wait up to 3 minutes for boot
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try {
      const res = await fetch(`${baseUrl}/config`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal,
      });
      if (res.ok) {
        spaceAwakeCache.set(baseUrl, Date.now());
        return;
      }
      // 401/403 means the Space is up but rejecting auth — stop waiting
      if (res.status === 401 || res.status === 403) return;
    } catch {
      // network error while booting → keep polling
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Space is waking up, please try again in a moment");
};

// --- Gradio File Upload Helper ---

// Downscale + recompress a blob to stay under Gradio HF Space upload limits.
// Returns a JPEG Blob (or the original if already small enough).
const MAX_UPLOAD_BYTES = 1.8 * 1024 * 1024; // 1.8 MB, Gradio Spaces typically allow 2-5 MB
const MAX_UPLOAD_DIM = 2048;

const compressImageForUpload = async (blob: Blob): Promise<Blob> => {
  if (blob.size <= MAX_UPLOAD_BYTES) return blob;

  const bitmap = await createImageBitmap(blob);
  let w = bitmap.width;
  let h = bitmap.height;
  if (w > MAX_UPLOAD_DIM || h > MAX_UPLOAD_DIM) {
    const r = Math.min(MAX_UPLOAD_DIM / w, MAX_UPLOAD_DIM / h);
    w = Math.round(w * r);
    h = Math.round(h * r);
  }
  const cvs = document.createElement("canvas");
  cvs.width = w;
  cvs.height = h;
  const ctx = cvs.getContext("2d");
  if (!ctx) return blob;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  // Progressive JPEG quality until we're under the limit
  for (const q of [0.92, 0.85, 0.78, 0.7, 0.62]) {
    const out: Blob | null = await new Promise((res) =>
      cvs.toBlob((b) => res(b), "image/jpeg", q),
    );
    if (out && out.size <= MAX_UPLOAD_BYTES) return out;
  }
  // Last resort — return the smallest we got (quality 0.62) even if still over
  const last: Blob | null = await new Promise((res) =>
    cvs.toBlob((b) => res(b), "image/jpeg", 0.55),
  );
  return last || blob;
};

export const uploadToGradio = async (
  baseUrl: string,
  image: string | Blob,
  token: string | null,
  signal?: AbortSignal,
): Promise<string> => {
  await ensureSpaceAwake(baseUrl, token, signal);

  const formData = new FormData();
  formData.append("files", image);

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Gradio 5.x uses /gradio_api/upload; Gradio 4.x uses the legacy /upload
  let response = await fetch(`${baseUrl}/gradio_api/upload`, {
    method: "POST",
    headers,
    body: formData,
    signal,
  });

  if (response.status === 404) {
    response = await fetch(`${baseUrl}/upload`, {
      method: "POST",
      headers,
      body: formData,
      signal,
    });
  }

  if (!response.ok) {
    throw new Error(`Failed to upload image to Gradio: ${response.statusText}`);
  }

  const result = await response.json();
  if (!result || !result[0]) {
    throw new Error("Invalid upload response from Gradio");
  }

  return result[0]; // Returns the filename/path relative to the Gradio space
};

// --- Gradio Queue Helper (New Logic) ---

interface GradioPayload {
  data: any[];
  fn_index: number;
  trigger_id: number;
  session_hash: string;
  event_data: null;
}

const runGradioTask = async <T>(
  baseUrl: string,
  data: any[],
  fn_index: number,
  trigger_id: number,
  token: string | null,
  signal?: AbortSignal,
): Promise<T> => {
  const session_hash = Date.now().toString(16);

  await ensureSpaceAwake(baseUrl, token, signal);

  // 1. Join Queue
  const payload: GradioPayload = {
    data,
    fn_index,
    trigger_id,
    session_hash,
    event_data: null,
  };

  // Gradio 5.x exposes queue routes under /gradio_api; Gradio 4.x uses the
  // legacy /queue/* routes. Fall back on 404 so both Space versions work.
  let apiPrefix = "/gradio_api";

  const joinOptions: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    signal,
  };

  let joinResponse = await fetch(
    `${baseUrl}${apiPrefix}/queue/join`,
    joinOptions,
  );

  if (joinResponse.status === 404) {
    apiPrefix = "";
    joinResponse = await fetch(
      `${baseUrl}${apiPrefix}/queue/join`,
      joinOptions,
    );
  }

  if (!joinResponse.ok) {
    // Handle 429 or other errors as quota exhausted if applicable
    if (joinResponse.status === 429) throw new Error(QUOTA_ERROR_KEY);
    throw new Error(`Gradio Join Error: ${joinResponse.status}`);
  }

  // 2. Listen for Result via SSE
  const sseResponse = await fetch(
    `${baseUrl}${apiPrefix}/queue/data?session_hash=${session_hash}`,
    {
      headers: {
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal,
    },
  );

  if (!sseResponse.ok) {
    if (sseResponse.status === 429) throw new Error(QUOTA_ERROR_KEY);
    throw new Error(`Gradio SSE Error: ${sseResponse.status}`);
  }

  const reader = sseResponse.body?.getReader();
  if (!reader) throw new Error("No response body from Gradio stream");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep partial line for next chunk

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6).trim();
          try {
            const msg = JSON.parse(jsonStr);

            if (msg.msg === "process_completed") {
              if (msg.success) {
                return msg.output as T;
              } else {
                // Enhanced Error Handling based on HF Data Structure
                const output = msg.output || {};
                // HF typical error detail key is " ", or "error"
                const detail = output[" "] || output.error || "";
                const title =
                  msg.title || output.title || "Gradio task process failed";

                const fullMessage = detail ? `${title}: ${detail}` : title;

                // Check if this is a quota error to trigger token rotation
                if (
                  fullMessage.includes("You have exceeded your free") &&
                  (fullMessage.includes("GPU quota") ||
                    fullMessage.includes("ZeroGPU"))
                ) {
                  throw new Error(QUOTA_ERROR_KEY);
                }

                throw new Error(fullMessage);
              }
            }

            if (msg.msg === "close_stream") {
              // Stream closed, loop will terminate naturally or we throw if no result found
            }
          } catch (e) {
            // If it's our own error or the quota key, rethrow to be caught by runWithTokenRetry
            if (
              e instanceof Error &&
              (e.message === QUOTA_ERROR_KEY ||
                e.message.includes(":") ||
                e.message.includes("failed"))
            ) {
              throw e;
            }
            // Otherwise ignore parse errors or irrelevant messages
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  throw new Error("Gradio stream closed without result");
};

// --- Gradio v2 API Helper (Gradio 5.x+ named endpoints) ---

/**
 * Map app-level aspect ratio strings to the qwen-image-2-1-studio space's
 * dropdown values (e.g. "1:1" → "Square · 1:1").
 */
const ASPECT_RATIO_TO_STUDIO_RATIO: Record<string, string> = {
  "1:1": "Square · 1:1",
  "16:9": "Landscape · 16:9",
  "9:16": "Portrait · 9:16",
  "4:3": "Landscape · 4:3",
  "3:4": "Portrait · 3:4",
  // Fallbacks — snap to closest studio-supported ratio
  "3:2": "Landscape · 4:3",
  "2:3": "Portrait · 3:4",
  "4:5": "Portrait · 3:4",
  "5:4": "Landscape · 4:3",
};

const mapAspectRatioToStudio = (
  ratio: AspectRatioOption,
): string => {
  return ASPECT_RATIO_TO_STUDIO_RATIO[ratio] || "Square · 1:1";
};

/**
 * Run a task on a Gradio 5.x+ Space using the /gradio_api/call/v2/{endpoint}
 * protocol. Unlike the legacy fn_index/trigger_id queue/join flow, the v2
 * API uses named endpoints and named (JSON) parameters.
 */
const runGradioV2Task = async <T>(
  baseUrl: string,
  endpoint: string,
  params: Record<string, any>,
  token: string | null,
  signal?: AbortSignal,
): Promise<T> => {
  await ensureSpaceAwake(baseUrl, token, signal);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // 1. Initiate the call — try v2 named-params protocol first,
  //    fall back to positional {data: [...]} on /gradio_api/call/{endpoint}
  //    (some Gradio 6.x Spaces only expose the positional route).
  let joinData: any;
  {
    let joinRes = await fetch(
      `${baseUrl}/gradio_api/call/v2/${endpoint}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(params),
        signal,
      },
    );

    if (joinRes.status === 405) {
      // Fallback: positional data array on the non-v2 call route
      joinRes = await fetch(`${baseUrl}/gradio_api/call/${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ data: Object.values(params) }),
        signal,
      });
    }

    if (!joinRes.ok) {
      if (joinRes.status === 429) throw new Error(QUOTA_ERROR_KEY);
      const errText = await joinRes.text().catch(() => "");
      throw new Error(`Gradio v2 Join Error: ${joinRes.status} ${errText}`);
    }

    joinData = await joinRes.json();
  }

  const eventId = joinData.event_id;
  if (!eventId) {
    throw new Error("Gradio v2: no event_id in join response");
  }

  // 2. Listen for result via SSE
  const sseRes = await fetch(
    `${baseUrl}/gradio_api/call/${endpoint}/${eventId}`,
    {
      headers: {
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal,
    },
  );

  if (!sseRes.ok) {
    if (sseRes.status === 429) throw new Error(QUOTA_ERROR_KEY);
    throw new Error(`Gradio v2 SSE Error: ${sseRes.status}`);
  }

  const reader = sseRes.body?.getReader();
  if (!reader) throw new Error("No response body from Gradio v2 stream");

  const decoder = new TextDecoder();
  let buffer = "";

  // Per SSE-event accumulator
  let evName = "";
  let dataLines: string[] = [];

  // Returns { result } or undefined; throws for real errors
  const flushEvent = (): { result: T } | undefined => {
    // Capture BEFORE resetting accumulators
    const name = evName;
    const raw = dataLines.join("\n").trim();
    evName = "";
    dataLines = [];

    if (!name && !raw) return undefined;

    console.warn("[Gradio v2] SSE event:", name || "(no event)", raw.slice(0, 300));

    let parsed: unknown = undefined;
    if (raw) {
      try { parsed = JSON.parse(raw); } catch { /* non-JSON payload → ignore */ }
    }

    // --- Gradio 6.x new protocol: event=complete, data=raw array ---
    if (name === "complete" && Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object" && typeof (item as any).url === "string") {
          (item as any).url = (item as any).url.replace(/[`\s]/g, "");
        }
      }
      return { result: { data: parsed } as T };
    }

    if (name === "error") {
      if (parsed && typeof parsed === "object") {
        const p = parsed as Record<string, any>;
        const detail = p.detail || p.message || JSON.stringify(parsed).slice(0, 200);
        throw new Error(`Gradio v2 error: ${detail}`);
      }
      throw new Error("Gradio v2 error: server returned an error (no details)");
    }

    // --- Older Gradio 5.x v2 protocol: {msg, success, output} ---
    if (parsed && typeof parsed === "object" && (parsed as any).msg === "process_completed") {
      const m = parsed as Record<string, any>;
      if (m.success) {
        const out = m.output;
        const result: T = Array.isArray(out)
          ? ({ data: out } as T)
          : (out as T);
        return { result };
      } else {
        const out = m.output || {};
        const detail = out[" "] || out.error || m.error || "";
        const title = m.title || out.title || "Gradio v2 task failed";
        const fullMessage = detail ? `${title}: ${detail}` : title;
        if (fullMessage.includes("exceeded your free GPU quota")) {
          throw new Error(QUOTA_ERROR_KEY);
        }
        throw new Error(fullMessage);
      }
    }

    // Heartbeats, progress events, null payloads, unknown events → silently ignore
    return undefined;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const rawLines = buffer.split("\n");
      buffer = rawLines.pop() || "";

      for (const rawLine of rawLines) {
        const line = rawLine.replace(/\r$/, "");

        if (line === "") {
          const r = flushEvent();
          if (r !== undefined) return r.result;
          continue;
        }

        if (line.startsWith("event:")) {
          evName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const d = line.slice(5);
          dataLines.push(d.startsWith(" ") ? d.slice(1) : d);
        }
        // comments (:...) and unknown prefixes → ignore
      }
    }
    const finalResult = flushEvent();
    if (finalResult !== undefined) return finalResult.result;
  } finally {
    reader.releaseLock();
  }

  throw new Error("Gradio v2 stream closed without result");
};

// --- Service Logic ---

const generateZImageModel = async (
  prompt: string,
  aspectRatio: AspectRatioOption,
  seed: number = Math.round(Math.random() * 2147483647),
  steps: number = 30,
  guidanceScale: number = 4,
  enableHD: boolean = false,
): Promise<GeneratedImage> => {
  const { width, height } = getDimensions(aspectRatio, enableHD);

  return runWithHFTokenRetry(async (token) => {
    try {
      const output: any = await runGradioTask(
        ZIMAGE_MODEL_BASE_API_URL,
        [
          prompt,
          Z_IMAGE_NEGATIVE_PROMPT,
          height,
          width,
          steps,
          guidanceScale,
          seed,
          false,
        ],
        2, // fn_index
        18, // trigger_id
        token,
      );

      const data = output.data;
      if (!data || !data[0]) throw new Error("error_invalid_response");

      // SSE returns nested structure: data[0] = [{image: {url: ...}, caption: null}]
      let url: string | undefined;
      if (Array.isArray(data[0]) && data[0][0]?.image?.url) {
        url = data[0][0].image.url;
      } else if (data[0]?.image?.url) {
        url = data[0].image.url;
      } else if (data[0]?.url) {
        url = data[0].url;
      } else if (typeof data[0] === "string") {
        url = data[0];
      }

      if (!url) throw new Error("error_invalid_response");

      return {
        id: generateUUID(),
        url,
        model: "z-image",
        prompt,
        aspectRatio,
        timestamp: Date.now(),
        seed,
        steps,
        guidanceScale,
      };
    } catch (error) {
      console.error("Z-Image Generation Error:", error);
      throw error;
    }
  });
};

const generateZImage = async (
  prompt: string,
  aspectRatio: AspectRatioOption,
  seed: number = Math.round(Math.random() * 2147483647),
  enableHD: boolean = false,
  steps: number = 9,
): Promise<GeneratedImage> => {
  const { width, height } = getDimensions(aspectRatio, enableHD);

  return runWithHFTokenRetry(async (token) => {
    try {
      const output: any = await runGradioTask(
        ZIMAGE_BASE_API_URL,
        [prompt, height, width, steps, seed, false],
        2, // fn_index
        16, // trigger_id
        token,
      );

      const data = output.data;
      if (!data || !data[0]) throw new Error("error_invalid_response");

      // SSE returns nested structure: data[0] = [{image: {url: ...}, caption: null}]
      let url: string | undefined;
      if (Array.isArray(data[0]) && data[0][0]?.image?.url) {
        url = data[0][0].image.url;
      } else if (data[0]?.image?.url) {
        url = data[0].image.url;
      } else if (data[0]?.url) {
        url = data[0].url;
      } else if (typeof data[0] === "string") {
        url = data[0];
      }

      if (!url) throw new Error("error_invalid_response");

      // Extract seed from data[1] if available
      const returnedSeed = typeof data[1] === "number" ? data[1] : seed;

      return {
        id: generateUUID(),
        url,
        model: "z-image-turbo",
        prompt,
        aspectRatio,
        timestamp: Date.now(),
        seed: returnedSeed,
        steps,
      };
    } catch (error) {
      console.error("Z-Image Turbo Generation Error:", error);
      throw error;
    }
  });
};

const generateFluxSchnellImage = async (
  prompt: string,
  aspectRatio: AspectRatioOption,
  seed: number = Math.round(Math.random() * 2147483647),
  enableHD: boolean = false,
  steps: number = 4,
): Promise<GeneratedImage> => {
  const { width, height } = getDimensions(aspectRatio, enableHD);

  return runWithHFTokenRetry(async (token) => {
    try {
      // Data: ["Prompt", Seed, Randomize seed (false), Width, Height, steps]
      const output: any = await runGradioTask(
        FLUX_SCHNELL_BASE_API_URL,
        [prompt, seed, false, width, height, steps],
        2, // fn_index
        5, // trigger_id
        token,
      );

      const data = output.data;
      if (!data || !data[0] || !data[0].url)
        throw new Error("error_invalid_response");

      return {
        id: generateUUID(),
        url: data[0].url,
        model: "flux-1-schnell",
        prompt,
        aspectRatio,
        timestamp: Date.now(),
        seed,
        steps,
      };
    } catch (error) {
      console.error("Flux Schnell Generation Error:", error);
      throw error;
    }
  });
};

const generateQwenImage = async (
  prompt: string,
  aspectRatio: AspectRatioOption,
  seed?: number,
  steps: number = 8,
): Promise<GeneratedImage> => {
  return runWithHFTokenRetry(async (token) => {
    try {
      // Logic from legacy: [prompt, seed || 42, seed === undefined, aspectRatio, 3, steps]
      const finalSeed = seed ?? 42;
      const randomize = seed === undefined;

      const output: any = await runGradioTask(
        QWEN_IMAGE_BASE_API_URL,
        [prompt, finalSeed, randomize, aspectRatio, 3, steps],
        1, // fn_index
        6, // trigger_id
        token,
      );

      const data = output.data;
      if (!data || !data[0] || !data[0].url)
        throw new Error("error_invalid_response");

      // Extract actual seed if returned in message (legacy did string parsing)
      // New format usually returns clean data, let's try to parse if available or fallback
      let returnedSeed = finalSeed;
      if (typeof data[1] === "string" && data[1].includes("Seed")) {
        returnedSeed = parseInt(
          data[1].replace("Seed used for generation: ", ""),
        );
      }

      return {
        id: generateUUID(),
        url: data[0].url,
        model: "qwen-image",
        prompt,
        aspectRatio,
        timestamp: Date.now(),
        seed: isNaN(returnedSeed) ? finalSeed : returnedSeed,
        steps,
      };
    } catch (error) {
      console.error("Qwen Image Fast Generation Error:", error);
      throw error;
    }
  });
};

const generateOvisImage = async (
  prompt: string,
  aspectRatio: AspectRatioOption,
  seed: number = Math.round(Math.random() * 2147483647),
  enableHD: boolean = false,
  steps: number = 24,
): Promise<GeneratedImage> => {
  const { width, height } = getDimensions(aspectRatio, enableHD);

  return runWithHFTokenRetry(async (token) => {
    try {
      const output: any = await runGradioTask(
        OVIS_IMAGE_BASE_API_URL,
        [prompt, height, width, seed, steps, 4],
        2, // fn_index
        5, // trigger_id
        token,
      );

      const data = output.data;
      if (!data || !data[0] || !data[0].url)
        throw new Error("error_invalid_response");

      return {
        id: generateUUID(),
        url: data[0].url,
        model: "ovis-image",
        prompt,
        aspectRatio,
        timestamp: Date.now(),
        seed,
        steps,
      };
    } catch (error) {
      console.error("Ovis Image Generation Error:", error);
      throw error;
    }
  });
};

export const editImageQwen = async (
  imageBlobs: (Blob | string)[],
  prompt: string,
  width: number,
  height: number,
  steps: number = 4,
  guidanceScale: number = 1,
  signal?: AbortSignal,
): Promise<GeneratedImage> => {
  return runWithHFTokenRetry(async (token) => {
    try {
      const seed = Math.round(Math.random() * 2147483647);

      // 1. Upload the last (merged) image to Gradio to get a temp path
      const lastItem = imageBlobs[imageBlobs.length - 1];
      let blob: Blob;
      if (typeof lastItem === "string") {
        blob = lastItem.startsWith("opfs://")
          ? await fetchCloudBlob(lastItem)
          : await fetchBlob(lastItem);
      } else {
        blob = lastItem;
      }
      const imagePath = await uploadToGradio(
        QWEN_IMAGE_EDIT_BASE_API_URL,
        await compressImageForUpload(blob),
        token,
        signal,
      );

      // 2. Call Inference via named endpoint /generate
      // Params: image(filepath), prompt, negative_prompt, steps, true_cfg_scale, seed
      const output: any = await runGradioV2Task(
        QWEN_IMAGE_EDIT_BASE_API_URL,
        "generate",
        {
          image: { path: imagePath, meta: { _type: "gradio.FileData" } },
          prompt,
          negative_prompt: "",
          steps,
          true_cfg_scale: guidanceScale,
          seed,
        },
        token,
        signal,
      );

      const data = output.data;
      // Output is an array; find the image URL
      let imageUrl: string | undefined;
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item && typeof item === "object") {
            const url = (item as any).url || (item as any).image?.url;
            if (url) {
              imageUrl = url;
              break;
            }
          }
        }
      }
      if (!imageUrl) throw new Error("error_invalid_response");

      return {
        id: generateUUID(),
        url: normalizeSpaceUrl(QWEN_IMAGE_EDIT_BASE_API_URL, imageUrl),
        model: "qwen-image-edit",
        prompt,
        aspectRatio: "custom",
        timestamp: Date.now(),
        seed,
        steps,
        provider: "huggingface",
      };
    } catch (error) {
      console.error("Qwen Image Edit Error:", error);
      throw error;
    }
  });
};

// --- Qwen Image 2.1 Studio (Gradio 6.x v2 API) ---

const generateQwenImage21 = async (
  prompt: string,
  aspectRatio: AspectRatioOption,
  seed?: number,
  steps: number = 40,
): Promise<GeneratedImage> => {
  return runWithHFTokenRetry(async (token) => {
    try {
      const randomize = seed === undefined;
      const finalSeed = seed ?? Math.round(Math.random() * 2147483647);
      const studioRatio = mapAspectRatioToStudio(aspectRatio);

      const output: any = await runGradioV2Task(
        QWEN_IMAGE_21_BASE_API_URL,
        "generate",
        {
          prompt,
          mode: "Create an image",
          reference: null,
          aspect_ratio: studioRatio,
          steps,
          seed: finalSeed,
          randomize_seed: randomize,
        },
        token,
      );

      const data = output.data;
      // Gradio v2 named endpoint returns data[0] = ImageData, data[1] = FileData
      // We prefer the URL from data[0] (the displayed image)
      let url: string | undefined;
      if (data?.[0]?.url) {
        url = normalizeSpaceUrl(QWEN_IMAGE_21_BASE_API_URL, data[0].url);
      } else if (data?.[1]?.url) {
        url = normalizeSpaceUrl(QWEN_IMAGE_21_BASE_API_URL, data[1].url);
      }
      if (!url) throw new Error("error_invalid_response");

      // data[2] = actual seed returned
      const returnedSeed =
        typeof data?.[2] === "number" ? data[2] : finalSeed;

      return {
        id: generateUUID(),
        url,
        model: "qwen-image-21",
        prompt,
        aspectRatio,
        timestamp: Date.now(),
        seed: returnedSeed,
        steps,
        provider: "huggingface",
      };
    } catch (error) {
      console.error("Qwen Image 2.1 Generation Error:", error);
      throw error;
    }
  });
};

export const editImageQwen21 = async (
  imageBlobs: (Blob | string)[],
  prompt: string,
  width: number,
  height: number,
  steps: number = 40,
  signal?: AbortSignal,
): Promise<GeneratedImage> => {
  return runWithHFTokenRetry(async (token) => {
    try {
      const finalSeed = Math.round(Math.random() * 2147483647);

      // Pick the best reference image: prefer the LAST blob (merged canvas
      // with user drawings), otherwise the first. The studio space accepts
      // only one reference image.
      const primaryItem = imageBlobs[imageBlobs.length - 1] ?? imageBlobs[0];
      let blob: Blob;
      if (typeof primaryItem === "string") {
        if (primaryItem.startsWith("opfs://")) {
          blob = await fetchCloudBlob(primaryItem);
        } else {
          blob = await fetchBlob(primaryItem);
        }
      } else {
        blob = primaryItem;
      }

      // Compress for Gradio HF Space upload limit (413 otherwise)
      blob = await compressImageForUpload(blob);

      const path = await uploadToGradio(
        QWEN_IMAGE_21_BASE_API_URL,
        blob,
        token,
        signal,
      );

      // Map actual image dimensions to the closest studio-supported ratio
      const ratio = width / height;
      let studioRatio = "Square · 1:1";
      if (ratio > 1.15) {
        studioRatio = ratio > 1.6 ? "Landscape · 16:9" : "Landscape · 4:3";
      } else if (ratio < 0.87) {
        studioRatio = ratio < 0.625 ? "Portrait · 9:16" : "Portrait · 3:4";
      }

      const output: any = await runGradioV2Task(
        QWEN_IMAGE_21_BASE_API_URL,
        "generate",
        {
          prompt,
          mode: "Edit an image",
          reference: { path, meta: { _type: "gradio.FileData" } },
          aspect_ratio: studioRatio,
          steps,
          seed: finalSeed,
          randomize_seed: false,
        },
        token,
        signal,
      );

      const data = output.data;
      let url: string | undefined;
      if (data?.[0]?.url) {
        url = normalizeSpaceUrl(QWEN_IMAGE_21_BASE_API_URL, data[0].url);
      } else if (data?.[1]?.url) {
        url = normalizeSpaceUrl(QWEN_IMAGE_21_BASE_API_URL, data[1].url);
      }
      if (!url) throw new Error("error_invalid_response");

      return {
        id: generateUUID(),
        url,
        model: "qwen-image-21-edit",
        prompt,
        aspectRatio: "custom",
        timestamp: Date.now(),
        seed:
          typeof data?.[2] === "number" ? data[2] : finalSeed,
        steps,
        provider: "huggingface",
      };
    } catch (error) {
      console.error("Qwen Image 2.1 Edit Error:", error);
      throw error;
    }
  });
};

export const enhancePromptQwen21 = async (
  originalPrompt: string,
  imageBlobs?: (Blob | string)[],
  signal?: AbortSignal,
): Promise<string> => {
  return runWithHFTokenRetry(async (token) => {
    try {
      let imagePaths: any[] | null = null;

      // Upload any provided images to the prompt-enhancer space
      if (imageBlobs && imageBlobs.length > 0) {
        imagePaths = [];
        for (const item of imageBlobs) {
          let blob: Blob;
          if (typeof item === "string") {
            if (item.startsWith("opfs://")) {
              blob = await fetchCloudBlob(item);
            } else {
              blob = await fetchBlob(item);
            }
          } else {
            blob = item;
          }
          const path = await uploadToGradio(
            QWEN_IMAGE_21_PROMPT_ENHANCER_URL,
            blob,
            token,
            signal,
          );
          imagePaths.push({
            path,
            meta: { _type: "gradio.FileData" },
          });
        }
      }

      const output: any = await runGradioV2Task(
        QWEN_IMAGE_21_PROMPT_ENHANCER_URL,
        "enhance",
        {
          prompt: originalPrompt,
          image_paths: imagePaths,
          max_new_tokens: 2048,
          enable_thinking: false,
          seed: 0,
          randomize_seed: true,
        },
        token,
        signal,
      );

      const data = output.data;
      // data[0] = rewritten prompt, data[1] = recommended aspect ratio
      if (data?.[0] && typeof data[0] === "string") {
        return data[0];
      }

      return originalPrompt;
    } catch (error) {
      console.error("Qwen Image 2.1 Prompt Enhance Error:", error);
      throw error;
    }
  });
};

export const generateImage = async (
  model: ModelOption,
  prompt: string,
  aspectRatio: AspectRatioOption,
  seed?: number,
  enableHD: boolean = false,
  steps?: number,
  guidanceScale?: number,
): Promise<GeneratedImage> => {
  const finalSeed = seed ?? Math.round(Math.random() * 2147483647);

  if (model === "qwen-image-21") {
    return generateQwenImage21(
      prompt,
      aspectRatio,
      seed,
      steps ?? 40,
    );
  } else if (model === "flux-1-schnell") {
    return generateFluxSchnellImage(
      prompt,
      aspectRatio,
      finalSeed,
      enableHD,
      steps,
    );
  } else if (model === "qwen-image") {
    return generateQwenImage(prompt, aspectRatio, seed, steps);
  } else if (model === "ovis-image") {
    return generateOvisImage(prompt, aspectRatio, finalSeed, enableHD, steps);
  } else if (model === "z-image") {
    return generateZImageModel(
      prompt,
      aspectRatio,
      finalSeed,
      steps,
      guidanceScale,
      enableHD,
    );
  } else {
    // Default to z-image-turbo
    return generateZImage(prompt, aspectRatio, finalSeed, enableHD, steps);
  }
};

export const upscaler = async (url: string): Promise<{ url: string }> => {
  // Fetch image as blob first to upload to Gradio. History images are stored
  // in OPFS (opfs:// URLs), which fetchBlob cannot read — use fetchCloudBlob.
  const blob = url.startsWith("opfs://")
    ? await fetchCloudBlob(url)
    : await fetchBlob(url);

  return runWithHFTokenRetry(async (token) => {
    try {
      // 1. Upload to Gradio
      const filePath = await uploadToGradio(UPSCALER_BASE_API_URL, blob, token);

      // 2. Call inference
      // phips-upscaler fn_index 1 (upscale_image) takes 2 inputs:
      // Input Image + Model dropdown; trigger_id 6 = "Upscale" button
      const output: any = await runGradioTask(
        UPSCALER_BASE_API_URL,
        [
          { path: filePath, meta: { _type: "gradio.FileData" } },
          "4xArtFaces_realplksr_dysample",
        ],
        1, // fn_index
        6, // trigger_id
        token,
      );

      const data = output.data;
      // Output layout: data[0] = [original, upscaled] webp previews for the
      // compare slider; data[1] = full-quality lossless PNG file output
      const fileUrl = normalizeSpaceUrl(UPSCALER_BASE_API_URL, data?.[1]?.url);
      const previewUrl = normalizeSpaceUrl(
        UPSCALER_BASE_API_URL,
        Array.isArray(data?.[0]) ? data[0][1]?.url : data?.[0]?.url,
      );
      const url = fileUrl || previewUrl;
      if (!url) throw new Error("error_invalid_response");

      return { url };
    } catch (error) {
      console.error("Upscaler Error:", error);
      throw Object.assign(new Error("error_upscale_failed"), { cause: error });
    }
  });
};

export const optimizePrompt = async (
  originalPrompt: string,
  model: string = "openai-fast",
): Promise<string> => {
  try {
    // Append the fixed suffix to the user's custom system prompt
    const systemInstruction =
      getSystemPromptContent() + FIXED_SYSTEM_PROMPT_SUFFIX;
    const apiModel = API_MODEL_MAP.huggingface[model] || model;

    const response = await fetch(POLLINATIONS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: apiModel,
        messages: [
          {
            role: "system",
            content: systemInstruction,
          },
          {
            role: "user",
            content: originalPrompt,
          },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error("error_prompt_optimization_failed");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    return content || originalPrompt;
  } catch (error) {
    console.error("Prompt Optimization Error:", error);
    throw Object.assign(new Error("error_prompt_optimization_failed"), {
      cause: error,
    });
  }
};

// --- Video Generation Services (HF) ---

const VIDEO_NEGATIVE_PROMPT =
  "Vivid colors, overexposed, static, blurry details, subtitles, style, artwork, painting, image, still, overall grayish tone, worst quality, low quality, JPEG compression artifacts, ugly, incomplete, extra fingers, poorly drawn hands, poorly drawn face, deformed, disfigured, malformed limbs, fused fingers, still image, cluttered background, three legs, many people in the background, walking backward, Screen shaking";

export const createVideoTaskHF = async (
  imageInput: string | Blob,
  seed: number = 42,
): Promise<string> => {
  return runWithHFTokenRetry(async (token) => {
    try {
      const finalSeed = seed ?? Math.floor(Math.random() * 2147483647);
      const settings = getVideoSettings("huggingface");

      let filePath = "";

      if (typeof imageInput === "string") {
        // Always upload — the Space may not be able to fetch remote URLs.
        const blob = await fetchCloudBlob(imageInput);
        filePath = await uploadToGradio(
          WAN2_VIDEO_API_URL,
          await compressImageForUpload(blob),
          token,
        );
      } else {
        filePath = await uploadToGradio(
          WAN2_VIDEO_API_URL,
          await compressImageForUpload(imageInput),
          token,
        );
      }

      // Call Inference using the Gradio v2 named endpoint API
      // (observantdistressed/wan2-2-i2v-v3 uses named parameters)
      const output: any = await runGradioV2Task(
        WAN2_VIDEO_API_URL,
        "generate_video",
        {
          input_image: { path: filePath, meta: { _type: "gradio.FileData" } },
          last_image: null,
          prompt: settings.prompt,
          steps: settings.steps,
          negative_prompt: VIDEO_NEGATIVE_PROMPT,
          duration_seconds: settings.duration,
          guidance_scale: settings.guidance,
          guidance_scale_2: settings.guidance,
          seed: finalSeed,
          randomize_seed: false,
          quality: 6,
          scheduler: "UniPCMultistep",
          flow_shift: 3,
          frame_multiplier: 16,
          safe_mode: true,
          lora_groups: [],
          auto_lora_enabled: true,
          video_component: true,
        },
        token,
      );

      const data = output.data;
      // Outputs: data[0] = video component FileData, data[1] = download FileData, data[2] = seed
      const rawUrl =
        data?.[0]?.url || data?.[0]?.video?.url || data?.[1]?.url;
      const url = normalizeSpaceUrl(WAN2_VIDEO_API_URL, rawUrl);
      if (url) return url;

      throw new Error("No video output returned");
    } catch (error) {
      console.error("Create Video Task HF Error:", error);
      throw error;
    }
  });
};
