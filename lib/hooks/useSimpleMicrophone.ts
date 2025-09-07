// lib/hooks/useSimpleMicrophone.ts
'use client';
import { useCallback, useEffect, useRef } from 'react';

import { useConversationStore } from '@/lib/state/conversation-store';

export const useSimpleMicrophone = () => {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const { status, wsConnection } = useConversationStore();

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];
        audioBlob.arrayBuffer().then((buffer) => {
          if (wsConnection?.readyState === WebSocket.OPEN) {
            wsConnection.send(buffer);
          }
        });
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(250); // chunk size
    } catch (error) {
      console.error('Microphone access failed:', error);
    }
  }, [wsConnection]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
  }, []);

  useEffect(() => {
    if (status === 'listening') {
      startRecording();
    } else {
      stopRecording();
    }
  }, [status, startRecording, stopRecording]);

  return { startRecording, stopRecording };
};
