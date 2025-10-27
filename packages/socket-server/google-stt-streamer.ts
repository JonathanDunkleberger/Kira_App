// packages/socket-server/google-stt-streamer.ts

import { SpeechClient } from '@google-cloud/speech';
import { EventEmitter } from 'events';

// Initialize the Google Speech Client
// Requires GOOGLE_APPLICATION_CREDENTIALS env var (JSON service account) or ADC in environment.
const speechClient = new SpeechClient();

// Configuration matching browser MediaRecorder (audio/webm;codecs=opus)
// Google supports WEBM_OPUS for streamingRecognize.
const STT_CONFIG = {
  encoding: 'WEBM_OPUS' as const,
  // Opus uses a 48kHz sampling rate internally
  sampleRateHertz: 48000,
  languageCode: 'en-US',
  // Improve punctuation for better downstream LLM quality
  enableAutomaticPunctuation: true,
};

export class GoogleSTTStreamer extends EventEmitter {
  private recognizeStream: ReturnType<SpeechClient['streamingRecognize']> | null = null;
  private fullTranscript: string = '';
  private configSent = false;

  constructor() {
    super();
    this.fullTranscript = '';

    // Create a new bi-directional stream (we'll send config as the FIRST message explicitly)
    this.recognizeStream = speechClient
      .streamingRecognize()
      .on('error', (error: any) => {
        console.error('[G-STT] Stream Error:', error);
        this.configSent = false; // Reset state on error
        this.emit('error', error);
      })
      .on('data', (data: any) => {
        const result = data?.results?.[0];
        const transcript = result?.alternatives?.[0]?.transcript || '';

        if (result?.isFinal) {
          if (transcript) {
            console.log(`[G-STT] ✅ Final Transcript Segment: "${transcript}"`);
            this.fullTranscript += transcript + ' ';
            this.emit('final_transcript_segment', transcript);
          }
          // If Google's VAD believes the utterance ended, emit utterance_end with the aggregated transcript
          if (this.fullTranscript.trim().length > 0) {
            this.emit('utterance_end', this.fullTranscript.trim());
          }
        } else if (transcript) {
          console.log(`[G-STT] Interim: ${transcript}`);
          this.emit('interim_transcript', transcript);
        }
      })
      .on('end', () => {
        console.log('[G-STT] Stream ended gracefully.');
        this.emit('close');
      });

    console.log('[G-STT] New Google STT Stream initialized.');

    // Immediately send the streaming configuration as the first message
    try {
      (this.recognizeStream as any).write({
        streamingConfig: {
          config: STT_CONFIG,
          interimResults: true,
        },
      });
      this.configSent = true;
      console.log('[G-STT] ✅ Configuration sent to stream.');
    } catch (e) {
      console.error('[G-STT] Failed to send initial streaming config:', e);
    }
  }

  // Pipe client audio chunks into the Google STT stream
  public write(audioChunk: Buffer) {
    if (!this.recognizeStream) return;
    if (!(this.recognizeStream as any).writable) return;
    if (!this.configSent) {
      console.warn('[G-STT] ⚠️ Attempted to write audio before config was sent. Skipping chunk.');
      return;
    }
    (this.recognizeStream as any).write({ audioContent: audioChunk });
  }

  // Signal the end of user's audio (from client EOU)
  public end() {
    if (this.recognizeStream && (this.recognizeStream as any).writable) {
      console.log('[G-STT] Received client EOU. Ending stream to force final result.');
      (this.recognizeStream as any).end();
    }
  }

  // Retrieve the full transcript collected so far
  public getFullTranscript(): string {
    return this.fullTranscript.trim();
  }
}
