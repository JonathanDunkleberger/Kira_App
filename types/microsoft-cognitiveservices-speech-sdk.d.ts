declare module 'microsoft-cognitiveservices-speech-sdk' {
  export const SpeechSynthesisOutputFormat: any;
  export const AudioOutputStream: any;
  export const AudioConfig: any;
  export const SpeechConfig: any;
  export class SpeechSynthesizer {
    constructor(speechConfig: any, audioConfig?: any);
    speakSsmlAsync(
      text: string,
      success: (result: any) => void,
      error: (err: string) => void,
    ): void;
    close(): void;
  }
}
