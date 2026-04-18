import { GoogleGenAI, Modality } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY || "";

let aiInstance: GoogleGenAI | null = null;

export function getAI() {
  if (!aiInstance) {
    if (!API_KEY) {
      throw new Error("GEMINI_API_KEY is missing. Please configure it in your secrets.");
    }
    aiInstance = new GoogleGenAI({ apiKey: API_KEY });
  }
  return aiInstance;
}

export interface TTSOptions {
  voiceName: string;
  text: string;
  tone: string;
  rate?: number;
}

export async function generateSpeech({ voiceName, text, tone, rate = 1.0 }: TTSOptions): Promise<string> {
  const ai = getAI();
  
  // Construct the prompt to include the persona instructions and speed
  const fullPrompt = `[Tone: ${tone}] [Speed: ${rate.toFixed(1)}x] ${text}`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-tts-preview",
    contents: [{ parts: [{ text: fullPrompt }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
      temperature: 0.7,
      topP: 0.90,
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error("Failed to generate audio data from Gemini.");
  }

  return base64Audio;
}
