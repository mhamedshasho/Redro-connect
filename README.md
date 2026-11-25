# Redro Connect

A local-first, peer-to-peer communication PWA for Android and desktop.

## Product principles

- Conversations and user data stay on the user's device.
- No Supabase, Firebase, or permanent central message database.
- Prefer direct WebRTC connections between peers.
- Use only the minimum signaling and connectivity assistance required to establish connections.
- Never claim guaranteed offline delivery: when a recipient is unavailable, delivery requires a temporary relay or a sender-side retry queue.
- Camera and microphone capabilities are detected independently.
- Video calling is unavailable when no supported camera is detected; messaging and audio capabilities remain independent.

## Initial technical direction

- Vanilla HTML, CSS, and JavaScript
- PWA: Web App Manifest and Service Worker
- IndexedDB for local identity and conversation data
- WebRTC for peer messaging and audio/video
- Web Crypto API for cryptographic primitives
- HTTPS hosting (GitHub Pages is the intended static host)

## Current milestone: local identity

- Creates a P-256 ECDSA identity key pair in the browser.
- Derives a stable Redro ID from the SHA-256 fingerprint of the public key.
- Stores the non-extractable private CryptoKey and public key locally in IndexedDB.
- Stores the display name locally and allows it to be edited.
- Supports copying and sharing the Redro ID.
- Does not upload identity data or private keys.

The identity is currently tied to this browser's local storage. Clearing site data or losing the device can permanently remove it. Encrypted identity backup and migration are future work and must be designed before multi-device identity is promised.

## Important network limitation

A stable user ID is not, by itself, a network address. Automatic peer discovery and connection setup require a signaling mechanism. Some network combinations also require STUN and, occasionally, TURN. TURN relays traffic and may consume bandwidth; it is not permanent message storage. The project will measure and document these dependencies rather than hide them.

## Run locally

Serve the repository over localhost or HTTPS. Camera, microphone, Web Crypto, service worker, and PWA installation features require a secure context.
