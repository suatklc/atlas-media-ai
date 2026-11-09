import { toFile } from "openai";
import { getOpenAITextClient } from "./client";

// Telegram voice instructions -> text (OpenAI speech-to-text). Server-only.
// One short paid call per voice note; the text is only used as the
// instruction for the existing content pipeline.
export const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";

export async function transcribeVoice(bytes: Buffer): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const result = await getOpenAITextClient().audio.transcriptions.create({
      file: await toFile(bytes, "voice.ogg", { type: "audio/ogg" }),
      model: TRANSCRIBE_MODEL,
      language: "tr",
    });
    const text = typeof result.text === "string" ? result.text.trim() : "";
    return text ? { ok: true, text } : { ok: false, error: "Ses kaydından metin çıkarılamadı." };
  } catch (error) {
    return { ok: false, error: `Ses kaydı çözülemedi (${error instanceof Error ? error.name : "error"}).` };
  }
}
