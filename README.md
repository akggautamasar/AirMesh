# BeyondMesh

**Offline, device-to-device data transfer — no internet, no server round-trip.**

BeyondMesh merges two channels into one app with a landing hub to pick between them:

- **SoundMesh** — transmits short text messages as audible tones between two devices' speaker and microphone, using [ggwave](https://github.com/ggerganov/ggwave).
- **QRMesh** — sends images, audio clips, or plain text as a scrolling sequence of QR codes, scanned by camera, using `qrcode` + `jsqr` + `pako` compression.

Both channels now support:

- **Optional password encryption.** Turn on "Encrypt" and set a password before sending — the tone/QR sequence itself can be handed to anyone (played out loud, scanned, or downloaded and shared through any app), but only someone who has the password can decode the actual content. This uses the browser's Web Crypto API (AES-256-GCM, PBKDF2-SHA256 key derivation) — the same construction AirVault used for its password-protected image encoding, just ported to run client-side.
- **Downloads.** There was no way to get the generated audio/QR out of the app before — now:
  - SoundMesh: **Download WAV** on the success screen, so you can send the tone as a file through WhatsApp/Telegram/email instead of only playing it live.
  - QRMesh: **Download This Frame** (PNG) and, for multi-frame sequences, **Download All Frames (.zip)** — so the whole scrolling sequence can be sent as files and scanned later from another screen.
  - QRMesh receive: a **Download** button on the "Built!" screen to save the received image/audio/text locally.

## Setup

```bash
npm install
npm run dev
```

This starts the Express + Vite dev server on `http://localhost:3000`.

## Build & run in production

```bash
npm run build
npm start
```

## Notes

- Microphone (SoundMesh) and camera (QRMesh) access require a secure context — `localhost` works for local dev, but testing across two physical devices needs HTTPS (a tunnel like ngrok/Cloudflare Tunnel, or deploying to a host that gives you HTTPS by default).
- Encrypted SoundMesh messages are not written to local history in the clear — only a "🔒 Encrypted message" placeholder is stored, since the password itself is never saved anywhere.
- This project was merged from two separate experiments (a browser-based DataMesh app and a Python/Flask AirVault image-steganography tool). AirVault's PNG/Telegram-storage pipeline is a different tech stack (server-side Python) and wasn't merged as a running service here — what was carried over is its core idea (optional password-based AES-256-GCM encryption of a payload), reimplemented client-side in `src/utils/crypto.ts` so it works the same way for both SoundMesh and QRMesh without needing a backend.
