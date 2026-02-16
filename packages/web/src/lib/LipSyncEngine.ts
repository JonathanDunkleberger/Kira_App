/**
 * LipSyncEngine — converts raw audio amplitude into smooth, natural mouth movement
 *
 * Key techniques:
 * 1. Separate attack/release smoothing (mouth opens fast, closes slowly — like real speech)
 * 2. Noise gate (ignores low-level noise so mouth stays closed during silence)
 * 3. Amplitude range mapping (maps usable range to 0.0–1.0)
 * 4. Frame-rate independent (uses deltaTime, works at any refresh rate)
 */
export class LipSyncEngine {
  // Smoothing parameters
  private attackSpeed = 0.4; // How fast mouth OPENS (0–1, higher = faster). 0.4 = ~3 frames to open
  private releaseSpeed = 0.12; // How fast mouth CLOSES (0–1, higher = faster). 0.12 = ~8 frames to close

  // Noise gate
  private noiseGate = 0.05; // Amplitude below this = silence (0.0–1.0 scale)

  // Range mapping — raw amplitude range that maps to 0.0–1.0 mouth openness
  // These may need tuning based on your TTS volume levels
  private ampFloor = 0.08; // Amplitude below this = mouth barely open
  private ampCeiling = 0.55; // Amplitude at/above this = mouth fully open

  // Max mouth openness (prevent unnatural wide-open jaw)
  private maxMouthOpen = 0.85;

  // State
  private currentValue = 0; // The smoothed output value (0.0–1.0)
  private targetValue = 0; // Where we're heading
  private lastTime = 0;

  constructor(options?: {
    attackSpeed?: number;
    releaseSpeed?: number;
    noiseGate?: number;
    ampFloor?: number;
    ampCeiling?: number;
    maxMouthOpen?: number;
  }) {
    if (options) {
      if (options.attackSpeed !== undefined) this.attackSpeed = options.attackSpeed;
      if (options.releaseSpeed !== undefined)
        this.releaseSpeed = options.releaseSpeed;
      if (options.noiseGate !== undefined) this.noiseGate = options.noiseGate;
      if (options.ampFloor !== undefined) this.ampFloor = options.ampFloor;
      if (options.ampCeiling !== undefined)
        this.ampCeiling = options.ampCeiling;
      if (options.maxMouthOpen !== undefined)
        this.maxMouthOpen = options.maxMouthOpen;
    }
  }

  /**
   * Feed raw amplitude (0.0–1.0) and get smooth mouth value back.
   * Call this every animation frame.
   *
   * @param rawAmplitude - Current audio amplitude, normalized to 0.0–1.0
   * @param timestamp - Performance.now() or similar timestamp in ms
   * @returns Smoothed mouth openness value (0.0–1.0)
   */
  update(rawAmplitude: number, timestamp: number): number {
    // Calculate deltaTime for frame-rate independence
    const deltaTime =
      this.lastTime === 0
        ? 16.67
        : Math.min(timestamp - this.lastTime, 50); // Cap at 50ms to prevent jumps
    this.lastTime = timestamp;
    const dtFactor = deltaTime / 16.67; // Normalize to ~60fps

    // Apply noise gate
    if (rawAmplitude < this.noiseGate) {
      this.targetValue = 0;
    } else {
      // Map amplitude from [ampFloor, ampCeiling] to [0, maxMouthOpen]
      const normalized = Math.max(
        0,
        Math.min(
          1,
          (rawAmplitude - this.ampFloor) / (this.ampCeiling - this.ampFloor)
        )
      );
      this.targetValue = normalized * this.maxMouthOpen;
    }

    // Apply asymmetric smoothing — fast attack, slow release
    const isOpening = this.targetValue > this.currentValue;
    const speed = isOpening ? this.attackSpeed : this.releaseSpeed;

    // Exponential interpolation (frame-rate independent)
    const smoothingFactor = 1 - Math.pow(1 - speed, dtFactor);
    this.currentValue +=
      (this.targetValue - this.currentValue) * smoothingFactor;

    // Snap to zero if very close (prevent infinite tiny oscillations)
    if (this.currentValue < 0.01) this.currentValue = 0;

    return this.currentValue;
  }

  /** Reset state (call when audio stops) */
  reset(): void {
    this.currentValue = 0;
    this.targetValue = 0;
    this.lastTime = 0;
  }

  /** Get current smoothed value without updating */
  getValue(): number {
    return this.currentValue;
  }
}
