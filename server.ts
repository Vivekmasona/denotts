// ========================================================
// Offline Realistic Female Voice TTS Server (Deno + Piper)
// No external API, works fully offline
// ========================================================
//
// Run with:
// deno run --allow-net --allow-run --allow-read --allow-write server_tts.ts
//
// Usage:
// http://localhost:8000/?text=Hello%20this%20is%20offline%20voice
//
// ========================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// === CONFIG ===
const PIPER_BIN = "./piper";                     // path to piper binary
const MODEL = "./en_US-amy-low.onnx";            // female voice model file
const TEMP_TEXT_FILE = "input.txt";
const RAW_WAV = "voice_raw.wav";
const FINAL_MP3 = "voice_final.mp3";

// === UTIL ===
async function generateVoice(text: string): Promise<Uint8Array | null> {
  try {
    // Save input text
    await Deno.writeTextFile(TEMP_TEXT_FILE, text);

    // 1️⃣ Run Piper (generate voice_raw.wav)
    const piper = new Deno.Command(PIPER_BIN, {
      args: [
        "--model", MODEL,
        "--output_file", RAW_WAV,
        "--text_file", TEMP_TEXT_FILE,
      ],
    });
    const piperResult = await piper.output();

    if (!piperResult.success) {
      console.error("❌ Piper failed:\n", new TextDecoder().decode(piperResult.stderr));
      return null;
    }

    // 2️⃣ Post-process using ffmpeg (volume + clarity)
    const ffmpeg = new Deno.Command("ffmpeg", {
      args: [
        "-y",                     // overwrite output
        "-i", RAW_WAV,            // input wav
        "-filter:a",
        // volume + light treble + subtle reverb for natural tone
        "loudnorm,treble=g=3,aecho=0.8:0.9:100:0.3,volume=1.1",
        "-ar", "44100",
        "-ac", "2",
        "-b:a", "192k",
        FINAL_MP3,
      ],
      stderr: "piped",
    });
    const ffmpegResult = await ffmpeg.output();

    if (!ffmpegResult.success) {
      console.error("❌ ffmpeg failed:\n", new TextDecoder().decode(ffmpegResult.stderr));
      return null;
    }

    // 3️⃣ Return MP3 data
    const mp3 = await Deno.readFile(FINAL_MP3);
    console.log("✅ Voice ready (" + text.slice(0, 40) + "...)");
    return mp3;

  } catch (err) {
    console.error("Error in generateVoice:", err);
    return null;
  }
}

// === SERVER ===
serve(async (req) => {
  try {
    const url = new URL(req.url);
    const text = url.searchParams.get("text");

    if (!text || text.trim().length === 0) {
      return new Response("⚠️ Use /?text=Your+message", { status: 400 });
    }

    console.log("🎙️ Generating:", text);

    const audio = await generateVoice(text);
    if (!audio) {
      return new Response("❌ TTS generation failed (see server log)", { status: 500 });
    }

    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Server error:", err);
    return new Response("Internal Server Error", { status: 500 });
  }
});

console.log("\n🎧 Offline TTS server running on → http://localhost:8000/");
console.log("👉 Try: http://localhost:8000/?text=Hello%20this%20is%20an%20offline%20female%20voice\n");
