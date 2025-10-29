// server_tts.ts
// Run: deno run --allow-net --allow-run --allow-read --allow-write server_tts.ts
// Offline real voice TTS server using Piper + ffmpeg

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Piper config
const MODEL = "en_US-amy-low.onnx"; // Female voice model
const PIPER_BIN = "./piper";

async function generateVoice(text: string): Promise<Uint8Array | null> {
  // Save text temporarily
  await Deno.writeTextFile("input.txt", text);

  // Step 1: Run Piper (generate voice_raw.wav)
  const piper = new Deno.Command(PIPER_BIN, {
    args: ["--model", MODEL, "--output_file", "voice_raw.wav", "--text_file", "input.txt"],
  });

  const result = await piper.output();
  if (!result.success) {
    console.error(new TextDecoder().decode(result.stderr));
    return null;
  }

  // Step 2: Post-process using ffmpeg
  const ffmpeg = new Deno.Command("ffmpeg", {
    args: [
      "-y",
      "-i",
      "voice_raw.wav",
      "-filter:a",
      "loudnorm,treble=g=3,aecho=0.8:0.9:100:0.3,volume=1.2",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-b:a",
      "192k",
      "voice_final.mp3",
    ],
  });

  const proc = await ffmpeg.output();
  if (!proc.success) {
    console.error(new TextDecoder().decode(proc.stderr));
    return null;
  }

  const data = await Deno.readFile("voice_final.mp3");
  return data;
}

// Simple HTTP Server
serve(async (req) => {
  const url = new URL(req.url);
  const text = url.searchParams.get("text");

  if (!text) {
    return new Response("Please provide text via ?text=hello", { status: 400 });
  }

  console.log(`🗣️ Generating voice for: "${text}"`);

  const audio = await generateVoice(text);
  if (!audio) {
    return new Response("TTS generation failed", { status: 500 });
  }

  return new Response(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-cache",
    },
  });
});

console.log("🎧 Offline TTS server running at http://localhost:8000/");
console.log("👉 Try: http://localhost:8000/?text=Hello%20there!");
