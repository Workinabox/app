# app

The React Native mobile app for Workinabox.

> **Status (2026-08-10): non-functional against the current backend, and
> parked.** The app talks plain `http://`/`ws://` with no credentials, but the
> backend is always-TLS and authenticates the `/signal` WebSocket, and the
> meeting signaling protocol has since changed. See SECURITY_REVIEW_OPUS48 M15
> and `docs/OVERVIEW.md`. The meeting subsystem is backend-complete but has no
> working client; reviving this app needs a native OAuth story first. The setup
> below describes the intended local flow, not something that currently connects.

## Stack

- React Native
- TypeScript
- `mediasoup-client`
- `react-native-webrtc`

## Role

The app is the mobile client for joining rooms exposed by the backend, establishing a signaling session, and sending and receiving real-time audio.

## Backend Connection

The app expects the backend on port `8080`.

- iOS simulator defaults to `http://127.0.0.1:8080`
- Android emulator defaults to `http://10.0.2.2:8080`
- Real devices on the same LAN require setting `LAN_BACKEND_HOST` in [`src/backendConfig.ts`](./src/backendConfig.ts)
