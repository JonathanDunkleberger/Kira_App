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

  constructor() {
    super();
    this.fullTranscript = '';

    const request = {
      config: STT_CONFIG,
      interimResults: true,
    } as const;

    // Create a new bi-directional stream
    this.recognizeStream = speechClient
      .streamingRecognize(request)
      .on('error', (error: any) => {
        console.error('[G-STT] Stream Error:', error);
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
  }

  // Pipe client audio chunks into the Google STT stream
  public write(audioChunk: Buffer) {
    if (this.recognizeStream && (this.recognizeStream as any).writable) {
      (this.recognizeStream as any).write({ audio_content: audioChunk });
    }
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
