import { initGGWave } from './ggwaveManager';

let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let scriptNode: ScriptProcessorNode | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;

export async function startListening(
  onSignalDetected: () => void,
  onMessageDecoded: (message: string) => void,
  onAudioData: (data: Float32Array) => void,
  onError: (error: Error) => void
) {
  try {
    const { instance, inst } = await initGGWave();

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    });

    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 48000,
      });
    }

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    
    // We use ScriptProcessorNode. While deprecated, it is the most reliable way 
    // to get raw audio data into the main thread for our WASM ggwave instance 
    // without dealing with WebWorker WASM messaging complexities.
    const bufferSize = 2048; 
    scriptNode = audioContext.createScriptProcessor(bufferSize, 1, 1);

    scriptNode.onaudioprocess = (audioProcessingEvent) => {
      const inputBuffer = audioProcessingEvent.inputBuffer;
      const inputData = inputBuffer.getChannelData(0); // Float32Array
      
      // Pass copy to visualizer
      onAudioData(new Float32Array(inputData));

      // ggwave expects Int8Array mapping of the Float32Array bytes
      const bytes = new Int8Array(inputData.buffer, inputData.byteOffset, inputData.byteLength);
      
      const rxBytes = instance.decode(inst, bytes);
      
      // If it returned a non-empty Int8Array, we got a decoded payload
      if (rxBytes && rxBytes.length > 0) {
        const decodedString = new TextDecoder().decode(rxBytes);
        onMessageDecoded(decodedString);
      }
    };

    sourceNode.connect(scriptNode);
    scriptNode.connect(audioContext.destination);

  } catch (error: any) {
    console.error("Listening error:", error);
    onError(error);
  }
}

/**
 * Decode an uploaded audio file (WAV, etc.) instead of listening live.
 * Used by SoundMesh's "Upload audio file" option, and also lets you decode
 * a SoundMesh WAV that was downloaded and re-sent through another channel
 * (e.g. QRMesh's lossless file mode) without needing a live microphone.
 *
 * Resamples to the 48kHz mono format ggwave expects, then feeds it through
 * the decoder in the same chunk size the live mic path uses, so a WAV
 * exported by generateWavBlob() (or any faithful copy of it) decodes
 * reliably.
 */
export async function decodeAudioFile(
  file: File | Blob,
  onMessageDecoded: (message: string) => void,
  onError: (error: Error) => void,
  onProgress?: (pct: number) => void,
): Promise<boolean> {
  try {
    const { instance, inst } = await initGGWave();

    const arrayBuffer = await file.arrayBuffer();
    const decodeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
    await decodeCtx.close();

    const TARGET_SAMPLE_RATE = 48000;
    let samples: Float32Array;
    if (decoded.sampleRate === TARGET_SAMPLE_RATE && decoded.numberOfChannels === 1) {
      samples = decoded.getChannelData(0);
    } else {
      const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE);
      const src = offline.createBufferSource();
      src.buffer = decoded;
      src.connect(offline.destination);
      src.start(0);
      const rendered = await offline.startRendering();
      samples = rendered.getChannelData(0);
    }

    const bufferSize = 2048;
    let found = false;
    let foundMessage = '';

    for (let off = 0; off < samples.length; off += bufferSize) {
      const slice = samples.subarray(off, Math.min(off + bufferSize, samples.length));
      // ggwave expects a full-size buffer; zero-pad the final partial chunk.
      const frame = slice.length === bufferSize ? slice : (() => {
        const padded = new Float32Array(bufferSize);
        padded.set(slice);
        return padded;
      })();

      const bytes = new Int8Array(frame.buffer, frame.byteOffset, frame.byteLength);
      const rxBytes = instance.decode(inst, bytes);
      if (rxBytes && rxBytes.length > 0) {
        foundMessage = new TextDecoder().decode(rxBytes);
        found = true;
        break;
      }
      onProgress?.(Math.round((off / samples.length) * 100));
    }

    onProgress?.(100);

    if (found) {
      onMessageDecoded(foundMessage);
      return true;
    }
    onError(new Error('No SoundMesh signal found in this audio file.'));
    return false;
  } catch (error: any) {
    console.error('decodeAudioFile error:', error);
    onError(error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}

export function stopListening() {
  if (scriptNode && audioContext) {
    scriptNode.disconnect();
    if (sourceNode) sourceNode.disconnect();
    scriptNode = null;
    sourceNode = null;
  }
  
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
}
