// lib/hooks/useSimpleVoiceSocket.ts
'use client'
import { useEffect, useRef } from 'react'
import { useConversationStore } from '@/lib/state/conversation-store'

export const useSimpleVoiceSocket = () => {
  const wsRef = useRef<WebSocket | null>(null)
  const { setStatus, addMessage, setWsConnection } = useConversationStore()

  useEffect(() => {
    const connectWebSocket = () => {
      const url = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:10000'
      const ws = new WebSocket(url)

      ws.onopen = () => {
        setWsConnection(ws)
        wsRef.current = ws
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          switch (data.type) {
            case 'transcript':
              addMessage({ role: 'user', content: data.text })
              setStatus('processing')
              break
            case 'assistant_response':
              addMessage({ role: 'assistant', content: data.text })
              break
            case 'audio_ready':
              setStatus('speaking')
              break
            case 'ready_for_input':
              setStatus('listening')
              break
          }
        } catch (error) {
          // Binary or non-JSON data ignored in this simple hook
        }
      }

      ws.onclose = () => {
        setStatus('idle')
      }
    }

    connectWebSocket()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [addMessage, setStatus, setWsConnection])

  const sendAudio = (audioData: ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(audioData)
    }
  }

  return { sendAudio }
}
