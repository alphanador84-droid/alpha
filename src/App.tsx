import { useState, useRef, useEffect } from "react";
import { 
  Mic2, 
  Play, 
  Square, 
  Youtube, 
  Settings2, 
  Sparkles, 
  Volume2, 
  History, 
  AlertCircle,
  Loader2,
  ChevronRight,
  Music,
  Trash2,
  Download
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { generateSpeech } from "@/src/services/gemini";
import { GoogleGenAI } from "@google/genai";
import { 
  base64ToAudioBuffer, 
  resampleBuffer, 
  encodeWAV, 
  encodeMP3, 
  mixAudioBuffers,
  QUALITY_PRESETS,
  AudioFormat
} from "@/src/lib/audio-utils";

const BACKGROUND_TRACKS = [
  { id: 'none', label: 'None', url: null },
  { id: 'tech', label: 'Tech Review (Lo-Fi)', url: 'https://raw.githubusercontent.com/rafaelreis-hotmart/Audio-Samples/master/Lofi.mp3' },
  { id: 'news', label: 'Urgent News (Brass)', url: 'https://raw.githubusercontent.com/rafaelreis-hotmart/Audio-Samples/master/News.mp3' },
  { id: 'edu', label: 'Ambient Knowledge', url: 'https://raw.githubusercontent.com/rafaelreis-hotmart/Audio-Samples/master/Ambient.mp3' },
];

// Available voices in gemini-tts
const VOICES = ["Fenrir", "Zephyr", "Kore", "Charon", "Puck", "Aoede", "Eos", "Orpheus"];

// Example prompts from user
const EXAMPLES = [
  {
    title: "Intro",
    text: "أَهْلًا بِكُمْ يَا أَغْلَى مُتَابِعِينَ فِي الْعَالَمِ! الْيَوْمَ أَعْدَدْتُ لَكُمْ مَقْطَعًا مُذْهِلًا بِحَقٍّ، وَلَكِنْ قَبْلَ أَنْ نَبْدَأَ، لَا تَنْسَوْا الضَّغْطَ عَلَى زِرِّ الْإِعْجَابِ وَالِاشْتِرَاكِ فِي الْقَنَاةِ!"
  },
  {
    title: "Review",
    text: "انْظُرُوا يَا رِفَاقُ، هَذَا الْمُنْتَجُ سِعْرُهُ مِئَتَانِ وَخَمْسُونَ جُنَيْهًا فَقَطْ، وَصَرَاحَةً أَدَاؤُهُ فَاقَ تَوَقُّعَاتِي بِالنِّسْبَةِ لِهَذَا السِّعْرِ. جَرِّبُوهُ وَأَخْبِرُونِي بِآرَائِكُمْ فِي التَّعْلِيقَاتِ."
  }
];

export default function App() {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("Zephyr");
  const [tone, setTone] = useState("charismatic and eloquent YouTuber speaking in high-fidelity Modern Standard Arabic");
  const [exportFormat, setExportFormat] = useState<AudioFormat>("mp3");
  const [qualityPreset, setQualityPreset] = useState("high");
  const [volume, setVolume] = useState(0.8);
  const [speechRate, setSpeechRate] = useState(1.0);
  const [musicTrack, setMusicTrack] = useState('none');
  const [musicVolume, setMusicVolume] = useState(0.2);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInIframe] = useState(() => {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTashkeeling, setIsTashkeeling] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ id: string; text: string; url: string }[]>([]);
  
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume, audioUrl]);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstallable(false);
    }
    setDeferredPrompt(null);
  };

  const handleTashkeel = async () => {
    if (!text) return;
    setIsTashkeeling(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Add full Arabic diacritics (Tashkeel) to the following text. Maintain the exact meaning and structure. Only output the text with Tashkeel.\n\nText: ${text}`,
      });
      const tashkeeledText = response.text?.trim();
      if (tashkeeledText) {
        setText(tashkeeledText);
      }
    } catch (err) {
      setError("Failed to add diacritics. Please try again.");
      console.error(err);
    } finally {
      setIsTashkeeling(false);
    }
  };

  const handleGenerate = async () => {
    if (!text) return;
    setIsGenerating(true);
    setError(null);
    try {
      const personaInstructions = `
        Persona: Charismatic, eloquent Fusha YouTuber. 
        Style: Warm, friendly, energetic, and authoritative. 
        Rules: 
        - High-fidelity studio condenser microphone quality.
        - Perfect Modern Standard Arabic (MSA) grammar.
        - Strict Jeem (ج) as voiced postalveolar affricate.
        - Strict Qaf (ق) as voiceless uvular plosive (NO glottal stop).
        - Formal numbers (e.g., Ahada 'Ashar for 11).
        - Correct currency usage (e.g., Junayhan).
        - Use natural transitions like 'أيها الأصدقاء' or 'تأملوا معي'.
        Tone: ${tone}.
      `;
      const fullText = `[Tone: ${personaInstructions}] ${text}`;
      
      const base64 = await generateSpeech({ 
        voiceName: voice, 
        text: fullText, 
        tone: "",
        rate: speechRate
      });

      // --- Processing & Conversion ---
      const preset = QUALITY_PRESETS[qualityPreset];
      
      // 1. Convert PCM base64 to AudioBuffer (source is 24kHz)
      const rawBuffer = await base64ToAudioBuffer(base64, 24000);
      
      // 2. Resample to target rate
      let finalBuffer = await resampleBuffer(rawBuffer, preset.sampleRate);
      
      // --- Background Music Mixing ---
      const selectedTrack = BACKGROUND_TRACKS.find(t => t.id === musicTrack);
      if (selectedTrack && selectedTrack.url) {
        try {
          const musicResponse = await fetch(selectedTrack.url);
          if (!musicResponse.ok) throw new Error("Music track unavailable");
          
          const musicArrayBuffer = await musicResponse.arrayBuffer();
          const musicContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          
          // Modern promise-based decoding with fallback
          const musicBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
            musicContext.decodeAudioData(musicArrayBuffer, resolve, reject);
          });
          
          finalBuffer = await mixAudioBuffers(
            finalBuffer,
            musicBuffer,
            1.0, 
            musicVolume
          );
        } catch (mixErr) {
          console.error("Failed to mix background music, continuing with speech only:", mixErr);
          // We don't throw here to ensure speech is still delivered even if music fails
        }
      }

      // 3. Encode to target format
      let blob: Blob;
      if (exportFormat === 'mp3') {
        blob = encodeMP3(finalBuffer, preset.bitrate);
      } else {
        blob = encodeWAV(finalBuffer);
      }

      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      
      // Add to history
      setHistory(prev => [{ id: Date.now().toString(), text: text.slice(0, 50) + "...", url }, ...prev].slice(0, 5));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate speech. Check your API key.");
    } finally {
      setIsGenerating(false);
    }
  };

  const loadExample = (ex: { text: string }) => {
    setText(ex.text);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="h-16 border-b border-studio-border bg-studio-panel px-6 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-studio-accent rounded-lg flex items-center justify-center">
            <Youtube className="text-white fill-current" />
          </div>
          <h1 className="text-xl font-display italic font-bold tracking-tight">
            Fusha <span className="text-studio-accent">YouTuber</span> Studio
          </h1>
        </div>
        <div className="flex items-center gap-4">
          {isInstallable ? (
            <button
              onClick={handleInstall}
              className="flex items-center gap-2 px-4 py-2 bg-studio-accent hover:brightness-110 text-white rounded-lg text-sm font-bold transition-all animate-bounce hover:animate-none"
            >
              <Download className="w-4 h-4" />
              تثبيت التطبيق
            </button>
          ) : isInIframe && (
            <a
              href={window.location.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-studio-border hover:bg-studio-accent/20 border border-transparent rounded-lg text-xs font-medium transition-all text-gray-400 group"
            >
              <ChevronRight className="w-3 h-3 text-studio-accent group-hover:translate-x-1 transition-transform" />
              افتح في نافذة جديدة لتثبيت التطبيق
            </a>
          )}
          <div className="flex items-center gap-4 text-xs font-mono text-gray-500 uppercase tracking-widest">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Live System
          </div>
          <div className="h-4 w-px bg-studio-border" />
          v1.0.4 - Premium Audio
        </div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_400px]">
        {/* Editor Area */}
        <section className="p-8 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-mono text-gray-400 uppercase tracking-widest">
              <Sparkles className="w-4 h-4 text-studio-accent" />
              Script Editor
            </h2>
            <div className="flex gap-2">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => loadExample(ex)}
                  className="px-3 py-1 text-xs border border-studio-border hover:border-studio-accent rounded-full transition-colors text-gray-400 hover:text-white"
                >
                  Example: {ex.title}
                </button>
              ))}
            </div>
          </div>

          <div className="relative group">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              dir="rtl"
              placeholder="اكتب نصك هنا باللغة العربية الفصحى..."
              className="w-full h-[400px] bg-studio-panel border border-studio-border rounded-xl p-8 text-xl leading-relaxed text-right font-sans focus:ring-2 focus:ring-studio-accent focus:border-transparent outline-none transition-all resize-none shadow-2xl"
            />
            <div className="absolute bottom-6 left-6 flex items-center gap-3">
              <button
                onClick={handleTashkeel}
                disabled={!text || isTashkeeling}
                className="flex items-center gap-2 px-4 py-2 bg-studio-border hover:bg-studio-accent/20 border border-transparent rounded-lg text-sm font-medium transition-all disabled:opacity-50"
              >
                {isTashkeeling ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 text-studio-accent" />
                )}
                Auto-Tashkeel
              </button>
            </div>
            <div className="absolute top-6 right-6 text-xs text-gray-500 font-mono">
              {text.length} characters
            </div>
          </div>

          <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-studio-accent shrink-0 mt-0.5" />
            <p className="text-sm text-gray-400">
              <strong className="text-orange-400">Studio Tip:</strong> Always use full diacritics (Tashkeel) for the most accurate pronunciation. The AI persona is optimized for high-energy, charismatic delivery.
            </p>
          </div>
        </section>

        {/* Controls Panel */}
        <aside className="border-l border-studio-border bg-studio-panel p-8 space-y-8 overflow-y-auto">
          {/* Generation Control */}
          <div className="space-y-4">
            <h3 className="text-xs font-mono text-gray-500 uppercase tracking-widest flex items-center gap-2">
              <Mic2 className="w-4 h-4 text-studio-accent" />
              Recording Settings
            </h3>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-gray-400">Voice Character</label>
                <div className="grid grid-cols-2 gap-2">
                  {VOICES.map((v) => (
                    <button
                      key={v}
                      onClick={() => setVoice(v)}
                      className={`px-3 py-2 text-sm rounded-lg border transition-all ${
                        voice === v 
                          ? "bg-studio-accent border-studio-accent text-white" 
                          : "bg-studio-bg border-studio-border text-gray-400 hover:border-gray-600"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-gray-400">Persona Style</label>
                <select 
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full bg-studio-bg border border-studio-border rounded-lg px-3 py-2 text-sm outline-none focus:border-studio-accent font-sans"
                >
                  <option value="charismatic and eloquent YouTuber">Charismatic YouTuber</option>
                  <option value="professional news anchor">News Anchor</option>
                  <option value="calm knowledge-based educator">Educator</option>
                  <option value="high-energy product reviewer">Product Reviewer</option>
                </select>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-gray-400">Speech Speed</label>
                  <span className="text-[10px] font-mono text-studio-accent">{speechRate.toFixed(1)}x</span>
                </div>
                <input 
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={speechRate}
                  onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                  className="w-full accent-studio-accent h-1.5 rounded-lg appearance-none bg-studio-border cursor-pointer transition-all"
                />
              </div>

              <div className="h-px bg-studio-border my-2" />

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs text-gray-400">Background Music</label>
                  <select 
                    value={musicTrack}
                    onChange={(e) => setMusicTrack(e.target.value)}
                    className="w-full bg-studio-bg border border-studio-border rounded-lg px-3 py-2 text-sm outline-none focus:border-studio-accent font-sans"
                  >
                    {BACKGROUND_TRACKS.map(track => (
                      <option key={track.id} value={track.id}>{track.label}</option>
                    ))}
                  </select>
                </div>

                {musicTrack !== 'none' && (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-xs text-gray-400">Music Mix Level</label>
                      <span className="text-[10px] font-mono text-studio-accent">{Math.round(musicVolume * 100)}%</span>
                    </div>
                    <input 
                      type="range"
                      min="0"
                      max="0.5"
                      step="0.01"
                      value={musicVolume}
                      onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
                      className="w-full accent-studio-accent h-1 rounded-lg appearance-none bg-studio-border cursor-pointer"
                    />
                  </div>
                )}
              </div>

              <div className="h-px bg-studio-border my-2" />

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-gray-400">Export Format</label>
                  <div className="flex bg-studio-bg border border-studio-border rounded-lg p-1">
                    {(['mp3', 'wav'] as AudioFormat[]).map((f) => (
                      <button
                        key={f}
                        onClick={() => setExportFormat(f)}
                        className={`flex-1 py-1 text-xs rounded uppercase font-bold transition-all ${
                          exportFormat === f ? "bg-studio-accent text-white" : "text-gray-500 hover:text-gray-300"
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-gray-400">Acoustics Quality</label>
                  <select 
                    value={qualityPreset}
                    onChange={(e) => setQualityPreset(e.target.value)}
                    className="w-full bg-studio-bg border border-studio-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-studio-accent font-sans"
                  >
                    {Object.entries(QUALITY_PRESETS).map(([id, p]) => (
                      <option key={id} value={id}>{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={!text || isGenerating}
              className={`w-full py-4 rounded-xl flex items-center justify-center gap-3 font-bold text-lg transition-all shadow-xl group ${
                isGenerating 
                  ? "bg-studio-border cursor-not-allowed" 
                  : "bg-studio-accent hover:brightness-110 active:scale-[0.98]"
              }`}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Generating Audio...
                </>
              ) : (
                <>
                  <Volume2 className="w-6 h-6 group-hover:animate-pulse" />
                  Produce Audio
                </>
              )}
            </button>
          </div>

          <div className="h-px bg-studio-border" />

          {/* Player Area */}
          <div className="space-y-4">
            <h3 className="text-xs font-mono text-gray-500 uppercase tracking-widest flex items-center gap-2">
              <Play className="w-4 h-4 text-studio-accent" />
              Studio Output
            </h3>

            {audioUrl ? (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-studio-bg border border-studio-border rounded-xl p-6 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-studio-accent/20 rounded-full flex items-center justify-center">
                      <Music className="w-5 h-5 text-studio-accent" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Final Production</p>
                      <p className="text-xs text-gray-500">24kHz | Mono | High-Fidelity</p>
                    </div>
                  </div>
                  <a 
                    href={audioUrl} 
                    download={`fusha-youtuber.${exportFormat}`}
                    className="text-xs text-studio-accent hover:underline"
                  >
                    Download .{exportFormat.toUpperCase()}
                  </a>
                </div>
                <audio 
                  key={audioUrl}
                  ref={audioRef}
                  src={audioUrl} 
                  controls 
                  className="w-full accent-studio-accent"
                />
                <div className="flex items-center gap-3 px-2">
                  <Volume2 className="w-4 h-4 text-gray-400 shrink-0" />
                  <input 
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="flex-1 accent-studio-accent h-1.5 rounded-lg appearance-none bg-studio-border cursor-pointer"
                  />
                  <span className="text-[10px] font-mono text-gray-500 w-8 text-right">
                    {Math.round(volume * 100)}%
                  </span>
                </div>
              </motion.div>
            ) : (
              <div className="h-32 border-2 border-dashed border-studio-border rounded-xl flex flex-col items-center justify-center gap-2 text-gray-500 italic text-sm">
                <Music className="w-6 h-6 opacity-20" />
                Waiting for production...
              </div>
            )}
          </div>

          <div className="h-px bg-studio-border" />

          {/* History */}
          <div className="space-y-4">
            <h3 className="text-xs font-mono text-gray-500 uppercase tracking-widest flex items-center gap-2">
              <History className="w-4 h-4 text-studio-accent" />
              Recent Takes
            </h3>
            <div className="space-y-2">
              <AnimatePresence>
                {history.map((take) => (
                  <motion.div
                    key={take.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center justify-between p-3 bg-studio-bg border border-studio-border rounded-lg group"
                  >
                    <div className="flex-1 min-w-0 pr-4 cursor-pointer" onClick={() => setAudioUrl(take.url)}>
                      <p className="text-xs text-gray-300 truncate font-arabic shrink-0 leading-relaxed" dir="rtl">
                        {take.text}
                      </p>
                    </div>
                    <button 
                      onClick={() => setAudioUrl(take.url)}
                      className="p-1 hover:text-studio-accent transition-colors shrink-0"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
              {history.length === 0 && (
                <p className="text-xs text-gray-600 italic">No history yet.</p>
              )}
            </div>
          </div>
        </aside>
      </main>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 px-6 py-4 bg-red-500/90 backdrop-blur-sm text-white rounded-xl shadow-2xl z-[100]"
          >
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm font-medium">{error}</p>
            <button onClick={() => setError(null)} className="ml-4 p-1 hover:bg-white/20 rounded">
              <Trash2 className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
