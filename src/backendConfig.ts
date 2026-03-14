import { Platform } from "react-native";

// Set this to your Mac's LAN IP for real phones on the same Wi-Fi.
// Empty string = use local emulator/simulator defaults.
const LAN_BACKEND_HOST = "";

const DEFAULT_HTTP_BASE_URL = LAN_BACKEND_HOST
  ? `http://${LAN_BACKEND_HOST}:8080`
  : Platform.OS === "android"
    ? "http://10.0.2.2:8080"
    : "http://127.0.0.1:8080";

export const HTTP_BASE_URL = DEFAULT_HTTP_BASE_URL;
export const SIGNAL_URL = `${HTTP_BASE_URL.replace(/^http/, "ws")}/signal`;
