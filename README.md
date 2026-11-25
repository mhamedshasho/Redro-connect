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

## Current milestone: manual WebRTC peer chat

- Creates a P-256 ECDSA identity key pair in the browser.
- Derives a stable Redro ID from the SHA-256 fingerprint of the public key.
- Stores the non-extractable private CryptoKey and public key locally in IndexedDB.
- Stores the display name locally and allows it to be edited.
- Supports copying and sharing the Redro ID.
- Does not upload identity data or private keys.

The identity is currently tied to this browser's local storage. Clearing site data or losing the device can permanently remove it. Encrypted identity backup and migration are future work and must be designed before multi-device identity is promised.

- Manual WebRTC offer/answer exchange using copy-and-paste connection codes.
- Real-time text messages over an ordered WebRTC DataChannel when peers connect.
- Local message history stored in IndexedDB on each participating device.
- No central message-history database or message relay server is included.
- A public STUN server is configured for NAT discovery; it does not store chat messages. No TURN relay is configured.
- Connection setup is manual in this milestone; a stable Redro ID alone cannot locate a device.

## Local contacts milestone

- Imports REDRO1 contact cards and validates the P-256 public key.
- Recomputes the SHA-256 fingerprint and rejects a card whose Redro ID does not match its public key.
- Saves contacts locally in IndexedDB and supports removal.
- Contact import does not create a network connection or prove that the person controls the private key.
- Connection codes include the peer public key and are checked against the Redro ID fingerprint before WebRTC setup.
- After the DataChannel opens, both peers sign fresh random challenges with their local ECDSA private keys. The receiving peer verifies the signature against the public key and checks that the challenge is addressed to its own Redro ID.
- Text sending is blocked until a valid peer proof is received. A saved contact's public key must match the key presented in the connection code.
- A saved contact can start a connection invitation directly from the contacts list. When an invitation was started for a specific saved contact, the reply must present the exact same Redro ID and public key.
- This is proof of possession of the key matching the Redro ID, not proof of a real-world person's name or an independent end-to-end security audit.

## Important network limitation

A stable user ID is not, by itself, a network address. Automatic peer discovery and connection setup require a signaling mechanism. Some network combinations also require STUN and, occasionally, TURN. TURN relays traffic and may consume bandwidth; it is not permanent message storage. The project will measure and document these dependencies rather than hide them.

## Run locally

Serve the repository over localhost or HTTPS. Camera, microphone, Web Crypto, service worker, and PWA installation features require a secure context.


## Local conversation overview

- The home screen derives a recent-conversation summary from the messages already stored in this browser.
- It displays the latest message preview, local message count, and last activity time for up to eight conversations.
- The summary is read-only and does not create a server-side conversation index or synchronize data between devices.
- Removing a contact does not delete its locally stored message history.


## Exporting local message history

- The Recent conversations section includes a user-triggered JSON export of all locally stored messages.
- The export contains message text, sender metadata, conversation IDs, and timestamps.
- The export is generated in the browser and is not uploaded to Redro or another server.
- Anyone who obtains the exported file may be able to read its contents. Store and share it carefully.
- Import and cross-device restoration are intentionally not implemented yet; untrusted message archives must be validated before any import feature is added.
