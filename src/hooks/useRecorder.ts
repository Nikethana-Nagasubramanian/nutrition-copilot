import { useCallback, useEffect, useRef, useState } from 'react';

export function useRecorder(onStop: (blob: Blob) => void, onError?: (error: unknown) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioFrameRef = useRef<number | null>(null);

  const stopMeter = useCallback(() => {
    if (audioFrameRef.current !== null) {
      cancelAnimationFrame(audioFrameRef.current);
      audioFrameRef.current = null;
    }
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    setLevel(0);
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    const AudioContextCtor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;
    try {
      const audioContext = new AudioContextCtor() as AudioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      audioContextRef.current = audioContext;

      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / samples.length);
        const nextLevel = Math.min(1, Math.max(0, (rms - 0.018) * 9));
        setLevel((current) => current * 0.72 + nextLevel * 0.28);
        audioFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Live level meter is best-effort; recording still works without it.
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      startMeter(stream);

      const mimeType = MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        stopMeter();
        if (blob.size > 0) onStop(blob);
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      stopMeter();
      setIsRecording(false);
      onError?.(err);
    }
  }, [onError, onStop, startMeter, stopMeter]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      stopMeter();
    };
  }, [stopMeter]);

  return { isRecording, startRecording, stopRecording, level };
}
