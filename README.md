# app

The React Native mobile app for Workinabox.

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
- Real devices on the same LAN require setting `LAN_BACKEND_HOST` in [`App.tsx`](./App.tsx)
