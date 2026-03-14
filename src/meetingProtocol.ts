import type {
  DtlsParameters,
  IceCandidate,
  IceParameters,
  MediaKind,
  RtpCapabilities,
  RtpParameters,
  SctpParameters,
} from "mediasoup-client/types";

export type ParticipantKind = "human" | "agent";
export type MeetingRole = "owner" | "moderator" | "participant";
export type MeetingState = "active" | "ended";

export type ParticipantSummary = {
  participant_id: string;
  kind: ParticipantKind;
  meeting_role: MeetingRole;
  name: string;
};

export type AgendaItem = {
  agenda_item_id: string;
  phrase: string;
};

export type MinutesAgendaItem = AgendaItem & {
  decisions: string[];
};

export type MinutesDocument = {
  meeting_id: string;
  title: string;
  owner_name: string;
  moderator_name: string;
  participants: ParticipantSummary[];
  started_at: string;
  ended_at: string;
  agenda: MinutesAgendaItem[];
};

export type MeetingSnapshot = {
  meeting_id: string;
  title: string;
  state: MeetingState;
  owner_participant_id: string;
  moderator_participant_id: string;
  participants: ParticipantSummary[];
  agenda: AgendaItem[];
  started_at: string;
  ended_at: string | null;
};

export type AgentUtterance = {
  utterance_id: string;
  participant_id: string;
  participant_name: string;
  text: string;
};

export type TransportDirection = "send" | "recv";

export type ClientSignal =
  | { type: "join_meeting"; meeting_id: string; participant_id: string }
  | { type: "end_meeting"; meeting_id: string }
  | { type: "create_webrtc_transport"; direction: TransportDirection }
  | {
      type: "connect_webrtc_transport";
      transport_id: string;
      dtls_parameters: DtlsParameters;
    }
  | {
      type: "produce";
      transport_id: string;
      kind: MediaKind;
      rtp_parameters: RtpParameters;
    }
  | {
      type: "consume";
      transport_id: string;
      producer_id: string;
      rtp_capabilities: RtpCapabilities;
    }
  | { type: "resume_consumer"; consumer_id: string }
  | { type: "ping" };

export type MeetingJoinedSignal = {
  type: "meeting_joined";
  peer_id: string;
  participant_id: string;
  meeting: MeetingSnapshot;
  router_rtp_capabilities: RtpCapabilities;
  existing_producer_ids: string[];
};

export type MeetingSnapshotSignal = {
  type: "meeting_snapshot";
  meeting: MeetingSnapshot;
};

export type AgentTextSignal = {
  type: "agent_text";
  meeting_id: string;
  participant_id: string;
  participant_name: string;
  utterance_id: string;
  text: string;
};

export type AgentAudioSignal = {
  type: "agent_audio";
  meeting_id: string;
  participant_id: string;
  participant_name: string;
  utterance_id: string;
  mime_type: string;
  audio_base64: string;
};

export type MeetingEndedSignal = {
  type: "meeting_ended";
  meeting_id: string;
  ended_by_participant_id: string;
  ended_at: string;
};

export type MinutesReadySignal = {
  type: "minutes_ready";
  meeting_id: string;
  minutes: MinutesDocument;
};

export type WebrtcTransportCreatedSignal = {
  type: "webrtc_transport_created";
  direction: TransportDirection;
  transport_id: string;
  ice_parameters: IceParameters;
  ice_candidates: IceCandidate[];
  dtls_parameters: DtlsParameters;
  sctp_parameters?: SctpParameters;
};

export type TransportConnectedSignal = {
  type: "transport_connected";
  transport_id: string;
};

export type ProducedSignal = {
  type: "produced";
  producer_id: string;
};

export type NewProducerSignal = {
  type: "new_producer";
  peer_id: string;
  producer_id: string;
};

export type ConsumedSignal = {
  type: "consumed";
  consumer_id: string;
  producer_id: string;
  kind: MediaKind;
  rtp_parameters: RtpParameters;
};

export type ConsumerResumedSignal = {
  type: "consumer_resumed";
  consumer_id: string;
};

export type PeerLeftSignal = {
  type: "peer_left";
  peer_id: string;
};

export type ErrorSignal = {
  type: "error";
  message: string;
};

export type PongSignal = {
  type: "pong";
};

export type ServerSignal =
  | MeetingJoinedSignal
  | MeetingSnapshotSignal
  | AgentTextSignal
  | AgentAudioSignal
  | MeetingEndedSignal
  | MinutesReadySignal
  | WebrtcTransportCreatedSignal
  | TransportConnectedSignal
  | ProducedSignal
  | NewProducerSignal
  | ConsumedSignal
  | ConsumerResumedSignal
  | PeerLeftSignal
  | ErrorSignal
  | PongSignal;

export type ServerEnvelope = ServerSignal & {
  request_id?: number;
};

export type PendingRequest = {
  resolve: (signal: ServerSignal) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};
