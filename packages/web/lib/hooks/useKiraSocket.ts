'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useConversationStore } from '@/lib/state/conversation-store';

type SocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export function useKiraSocket(conversationId: string | null) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [status, setStatus] = useState<SocketStatus>('disconnected');
  const { addMessage, setSpeaking } = useConversationStore();
  const [limitReachedReason, setLimitReachedReason] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const safeSend = useCallback((payload: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const startMic = useCallback(async () => {
    if (mediaRecorderRef.current) {
      console.log('[Audio] Mic already started.');
      return;
    }

    try {
      console.log('[Audio] Requesting microphone permission...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
      
      console.log('[Audio] ✅ Microphone permission granted.');
      const recorder = new MediaRecorder(stream, { 
        mimeType: 'audio/webm; codecs=opus',
        audioBitsPerSecond: 128000
      });
      
      mediaRecorderRef.current = recorder;
      
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
          console.log(`[Audio] ➡️ Sending audio chunk: ${event.data.size} bytes`);
          wsRef.current.send(event.data);
        }
      };
      
      recorder.onerror = (e: any) => {
        console.error('[Audio] ❌ MediaRecorder error:', e);
      };
      
      // Start recording with small chunks for low latency
      recorder.start(100);
      
    } catch (error) {
      console.error('[Audio] ❌ Error starting microphone:', error);
      setAuthError('Microphone access denied');
    }
  }, []);

  const stopMic = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      mediaRecorderRef.current = null;
    }
  }, []);

  const connect = useCallback(async () => {
    if (!conversationId || !isLoaded) return;
    if (wsRef.current) return;

    setStatus('connecting');
    setAuthError(null);

    try {
      // Wait for auth to be fully loaded
      let token: string | null = null;
      if (isSignedIn) {
        token = await getToken();
        if (!token) {
          throw new Error('Failed to get authentication token');
        }
      }

      const urlBase = process.env.NEXT_PUBLIC_WEBSOCKET_URL;
      if (!urlBase) {
        throw new Error('WebSocket URL not configured');
      }

      const url = new URL(urlBase);
      url.searchParams.set('conversationId', conversationId);
      if (token) {
        url.searchParams.set('token', token);
      }

      console.log('[WS] Connecting to WebSocket...');
      const ws = new WebSocket(url.toString());
      wsRef.current = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        console.log('[WS] ✅ Connected successfully');
        setStatus('connected');
        
        // Send ready signal to server
        safeSend({
          t: 'client_ready',
          session: conversationId,
          ua: navigator.userAgent
        });
      };

      ws.onerror = (error) => {
        console.error('[WS] ❌ Connection error:', error);
        setStatus('error');
        setAuthError('Connection failed');
      };

      ws.onclose = (event) => {
        console.log('[WS] 🔌 Connection closed:', event.code, event.reason);
        wsRef.current = null;
        setStatus('disconnected');
        stopMic();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('[WS] 📨 Received:', message.t);
          
          switch (message.t) {
            case 'chat_session':
              console.log('[WS] Chat session established:', message.chatSessionId);
              break;
              
            case 'transcript':
              addMessage({ role: 'user', content: message.text });
              break;
              
            case 'assistant_text_chunk':
              addMessage({ 
                role: 'assistant', 
                content: message.text || '', 
                isPartial: !message.done 
              });
              break;
              
            case 'tts_start':
              setSpeaking(true);
              break;
              
            case 'tts_chunk':
              // Handle audio playback (implementation TBD)
              console.log('[WS] Audio chunk received');
              break;
              
            case 'tts_end':
              setSpeaking(false);
              break;
              
            case 'limit_reached':
              setLimitReachedReason(message.reason);
              stopMic();
              break;
              
            case 'error':
              console.error('[WS] Server error:', message.message);
              setAuthError(message.message);
              break;
          }
        } catch (error) {
          console.error('[WS] ❌ Error parsing message:', error);
        }
      };

    } catch (error) {
      console.error('[WS] ❌ Connection setup failed:', error);
      setStatus('error');
      setAuthError(error instanceof Error ? error.message : 'Connection failed');
    }
  }, [conversationId, isLoaded, isSignedIn, getToken, safeSend, addMessage, setSpeaking, stopMic]);

  useEffect(() => {
    if (conversationId) {
      connect();
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      stopMic();
    };
  }, [connect, conversationId, stopMic]);

  return { 
    status, 
    startMic, 
    stopMic, 
    limitReachedReason, 
    setLimitReachedReason,
    authError 
  };
}
