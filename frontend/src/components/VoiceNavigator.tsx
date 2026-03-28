import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Volume2, X, Activity, Loader2 } from 'lucide-react';
import axios from 'axios';
import config from '../config';
import { encodeWAV } from '../utils/wavEncoder';

export default function VoiceNavigator() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const [isListening, setIsListening] = useState(false);
    const isListeningRef = useRef(false);
    const [lastTranscript, setLastTranscript] = useState('');
    const [status, setStatus] = useState<'idle' | 'listening' | 'success' | 'error' | 'processing'>('idle');
    const [feedback, setFeedback] = useState('');

    const audioCtx = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const audioData = useRef<Float32Array[]>([]);
    
    const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const isSpeakingRef = useRef<boolean>(false);

    const startListening = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });

            const source = audioCtx.current.createMediaStreamSource(stream);

            const analyser = audioCtx.current.createAnalyser();
            analyser.fftSize = 512;
            analyserRef.current = analyser;
            source.connect(analyser);

            const processor = audioCtx.current.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;
            audioData.current = [];
            isSpeakingRef.current = false;

            processor.onaudioprocess = (e) => {
                const input = e.inputBuffer.getChannelData(0);
                audioData.current.push(new Float32Array(input));

                if (!analyserRef.current || !isListeningRef.current) return;

                const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
                analyserRef.current.getByteTimeDomainData(dataArray);

                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    const amplitude = (dataArray[i] - 128) / 128;
                    sum += amplitude * amplitude;
                }
                const rms = Math.sqrt(sum / dataArray.length);
                const volume = rms * 100;

                const SILENCE_THRESHOLD = 2.0;

                if (volume > SILENCE_THRESHOLD) {
                    isSpeakingRef.current = true;
                    if (silenceTimerRef.current) {
                        clearTimeout(silenceTimerRef.current);
                        silenceTimerRef.current = null;
                    }
                } else {
                    if (isSpeakingRef.current && !silenceTimerRef.current) {
                        silenceTimerRef.current = setTimeout(() => {
                            if (isListeningRef.current) {
                                stopListening();
                            }
                        }, 1500);
                    }
                }
            };

            analyser.connect(processor);
            processor.connect(audioCtx.current.destination);

            setIsListening(true);
            isListeningRef.current = true;
            setStatus('listening');
            setFeedback("Speak your command...");
        } catch (err) {
            alert("Mic Error: " + (err instanceof Error ? err.message : String(err)));
        }
    };

    const stopListening = async () => {
        if (!isListeningRef.current) return;
        isListeningRef.current = false;

        setIsListening(false);
        setStatus('processing');
        setFeedback("AI is processing your voice...");

        if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
        }

        if (processorRef.current) processorRef.current.disconnect();
        if (analyserRef.current) analyserRef.current.disconnect();
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());

        const totalLength = audioData.current.reduce((acc, curr) => acc + curr.length, 0);

        if (totalLength === 0) {
            setStatus('error');
            setFeedback("No audio captured. Try again.");
            setTimeout(() => setStatus('idle'), 3000);
            return;
        }

        const merged = new Float32Array(totalLength);
        let offset = 0;
        for (const buffer of audioData.current) {
            merged.set(buffer, offset);
            offset += buffer.length;
        }

        const wavBlob = encodeWAV(merged, 16000);
        const formData = new FormData();
        formData.append('file', wavBlob, 'command.wav');

        try {
            const res = await axios.post(`${config.API_BASE_URL}/ai/transcribe-command`, formData);
            const { transcript, intent, confidence } = res.data;

            setLastTranscript(transcript);

            if (confidence > 0.1) {
                handleCommand(intent);
            } else {
                throw new Error("No clear intent detected");
            }
        } catch (err) {
            setStatus('error');
            setFeedback("I didn't understand that. Please try again.");
            setTimeout(() => setStatus('idle'), 3000);
        }
    };

    const handleCommand = (intent: string) => {

        const intents: Record<string, string> = {
            "go to dashboard": "/",
            "open dashboard": "/",

            "go to ledger": "/ledger",
            "open ledger": "/ledger",

            "go to matching partners": "/matching",
            "open matching": "/matching",

            "go to product catalog": "/catalog",
            "open catalog": "/catalog",

            "go to network snps": "/snp"
        };

        if (intents[intent]) {
            navigate(intents[intent]);
            showSuccess(`Opening ${intent}`);
            return;
        }

        if (intent.includes("language")) {

            const lang = intent.split(" ").pop()?.toLowerCase() || "";

            const languageMap: Record<string, string> = {
                english: "en",
                hindi: "hi",
                telugu: "te",
                tamil: "ta",
                malayalam: "ml",
                kannada: "kn",
                gujarati: "gu",
                bengali: "bn",
                marathi: "mr",
                punjabi: "pa",
                urdu: "ur"
            };

            const code = languageMap[lang] || "en";

            i18n.changeLanguage(code);

            showSuccess(`Language changed to ${lang}`);
        } else {
            setStatus('error');
            setFeedback("Command recognized but no action assigned.");
            setTimeout(() => setStatus('idle'), 3000);
        }
    };

    const showSuccess = (msg: string) => {
        setStatus('success');
        setFeedback(msg);
        setTimeout(() => setStatus('idle'), 3000);
    };

    return (
        <div className="fixed bottom-30 right-8 z-[200] flex flex-col items-end space-y-4">
            {status !== 'idle' && (
                <div className="px-6 py-4 rounded-2xl shadow-2xl border backdrop-blur-md min-w-[280px] bg-[#002147] text-white">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase">{status}</span>
                        <button onClick={() => setStatus('idle')}><X size={14} /></button>
                    </div>
                    <p className="text-xs font-bold">{feedback}</p>
                    {lastTranscript && <p className="mt-2 text-[10px] italic opacity-60">"{lastTranscript}"</p>}
                </div>
            )}

            <button
                onClick={isListening ? stopListening : startListening}
                className={`p-5 rounded-3xl shadow-2xl ${isListening ? 'bg-orange-600' : 'bg-[#002147]'}`}
            >
                {isListening ? <MicOff className="text-white" size={24} /> : <Mic className="text-white" size={24} />}
            </button>
        </div>
    );
}