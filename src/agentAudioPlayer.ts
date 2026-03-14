import { NativeModules } from "react-native";

export type AgentAudioPlayerModule = {
  playBase64Wav: (audioBase64: string) => Promise<void>;
};

export const agentAudioPlayer = (NativeModules.AgentAudioPlayer ?? null) as
  | AgentAudioPlayerModule
  | null;
