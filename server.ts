import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "2mb" }));

// Initialize GoogleGenAI server-side with required User-Agent header only when the key is configured.
const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
const ai = geminiApiKey
  ? new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    })
  : null;
const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY?.trim();
const elevenLabsVoiceId = "UgBBYS2sOqTuMpoF3BR0";

const DEFAULT_SYSTEM_INSTRUCTION = `You are a helpful voice assistant. Answer only using the information provided by the administrator. If the administrator has not supplied enough information, say that the information is missing and ask for the needed details.`;

function getAdminSystemInstruction(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }

  const candidateKeys = ["adminInfo", "systemInstruction", "instructions", "personality", "prompt", "adminPrompt"];
  for (const key of candidateKeys) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

// API endpoint for AI responses
app.post("/api/chat", async (req, res) => {
  try {
    const { query, language, adminInfo, systemInstruction, instructions } = req.body ?? {};
    if (!query || typeof query !== "string" || !query.trim()) {
      return res.status(400).json({ error: "Query is required" });
    }

    const cleanQuery = query.trim();
    const isBengali = (language && String(language).startsWith("bn")) || /[\u0980-\u09FF]/.test(cleanQuery);
    const adminPrompt = getAdminSystemInstruction({ adminInfo, systemInstruction, instructions, query: cleanQuery });
    const finalSystemInstruction = adminPrompt || DEFAULT_SYSTEM_INSTRUCTION;

    if (!ai) {
      return res.status(503).json({
        error: "General answers are unavailable because GEMINI_API_KEY is not configured on the server.",
      });
    }

    const candidateModels = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
    const userPrompt = isBengali
      ? `${cleanQuery}\n\n(Important: Please answer in natural, respectful, dignified Bengali without markdown symbols)`
      : cleanQuery;

    let lastModelError: unknown;
    for (const modelName of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: userPrompt,
          config: {
            systemInstruction: finalSystemInstruction,
            temperature: 0.6,
          },
        });

        const answer = response.text?.trim();
        if (answer) {
          return res.json({
            text: answer,
            success: true,
            source: `AI model (${modelName})`,
            verified: true,
          });
        }
      } catch (error) {
        lastModelError = error;
        console.error(`Gemini request failed for ${modelName}:`, error);
      }
    }

    console.error("All Gemini models failed to return an answer.", lastModelError);
    return res.status(502).json({
      error: "The AI service could not generate an answer. Please try again shortly.",
    });
  } catch (error: unknown) {
    console.error("Error in /api/chat:", error);
    return res.status(500).json({ error: "The AI service encountered an error. Please try again." });
  }
});

app.post("/api/speech", async (req, res) => {
  const text = req.body?.text;
  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Speech text is required" });
  }
  if (text.length > 5000) {
    return res.status(400).json({ error: "Speech text must be 5000 characters or fewer" });
  }
  if (!elevenLabsApiKey) {
    return res.status(503).json({ error: "ElevenLabs speech is unavailable. Configure ELEVENLABS_API_KEY on the server." });
  }

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elevenLabsVoiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": elevenLabsApiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: text.trim(),
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      console.error(`ElevenLabs TTS request failed (${response.status}):`, details);
      return res.status(502).json({ error: "ElevenLabs could not generate speech. Check the server configuration and voice access." });
    }

    const audio = Buffer.from(await response.arrayBuffer());
    res.set("Content-Type", "audio/mpeg");
    res.set("Cache-Control", "no-store");
    return res.send(audio);
  } catch (error) {
    console.error("Error generating ElevenLabs speech:", error);
    return res.status(502).json({ error: "ElevenLabs speech could not be reached. Please try again." });
  }
});

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "AI Voice Server", timestamp: new Date().toISOString() });
});

async function startServer() {
  // Vite middleware in dev / static serve in production
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AI Voice Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start AI Voice Server:", error);
  process.exit(1);
});
