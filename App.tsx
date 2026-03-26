import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Device } from "mediasoup-client";
import type {
  Consumer,
  DtlsParameters,
  MediaKind,
  Producer,
  RtpParameters,
  Transport,
} from "mediasoup-client/types";
import {
  MediaStream,
  mediaDevices,
  registerGlobals,
} from "react-native-webrtc";
import { HTTP_BASE_URL, SIGNAL_URL } from "./src/backendConfig";
import type {
  AgentUtterance,
  ClientSignal,
  ConsumedSignal,
  ConsumerResumedSignal,
  MeetingEndedSignal,
  MeetingJoinedSignal,
  MeetingSnapshot,
  MinutesDocument,
  PendingRequest,
  ProducedSignal,
  ServerEnvelope,
  ServerSignal,
  TransportConnectedSignal,
  TransportDirection,
  ParticipantSummary,
  WebrtcTransportCreatedSignal,
} from "./src/meetingProtocol";

function formatError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== "{}") {
      return serialized;
    }
  } catch {}
  return fallback;
}

function joinableParticipant(meeting: MeetingSnapshot): ParticipantSummary | null {
  return (
    meeting.participants.find(
      (participant) =>
        participant.participant_id === meeting.owner_participant_id &&
        participant.kind === "human",
    ) ??
    meeting.participants.find((participant) => participant.kind === "human") ??
    null
  );
}

export default function App() {
  const [meetings, setMeetings] = useState<MeetingSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [activeMeeting, setActiveMeeting] = useState<MeetingSnapshot | null>(null);
  const [activeParticipantId, setActiveParticipantId] = useState<string | null>(null);
  const [activeParticipantName, setActiveParticipantName] = useState<string | null>(null);
  const [status, setStatus] = useState("idle");
  const [connectionState, setConnectionState] = useState("new");
  const [micStatus, setMicStatus] = useState("idle");
  const [audioSendStatus, setAudioSendStatus] = useState("not sending");
  const [micEnabled, setMicEnabled] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [agentUtterances, setAgentUtterances] = useState<AgentUtterance[]>([]);
  const [minutes, setMinutes] = useState<MinutesDocument | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const sendTransportRef = useRef<Transport | null>(null);
  const recvTransportRef = useRef<Transport | null>(null);
  const producerRef = useRef<Producer | null>(null);
  const consumersRef = useRef<Map<string, Consumer>>(new Map());
  const localStreamRef = useRef<any | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAudioBytesRef = useRef<{ bytes: number; timestampMs: number } | null>(
    null,
  );
  const globalsRegisteredRef = useRef(false);
  const nextRequestIdRef = useRef(1);
  const pendingRequestsRef = useRef<Map<number, PendingRequest>>(new Map());
  const consumedProducerIdsRef = useRef<Set<string>>(new Set());
  const queuedProducerIdsRef = useRef<Set<string>>(new Set());

  const stopAudioStatsLoop = useCallback(() => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    lastAudioBytesRef.current = null;
    setAudioSendStatus("not sending");
  }, []);

  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      const tracks = localStreamRef.current.getTracks?.() ?? [];
      for (const track of tracks) {
        track.stop();
      }
      localStreamRef.current = null;
    }
    setMicStatus("idle");
    setMicEnabled(true);
  }, []);

  const rejectAllPendingRequests = useCallback((reason: string) => {
    for (const pending of pendingRequestsRef.current.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    pendingRequestsRef.current.clear();
  }, []);

  const disconnect = useCallback(() => {
    rejectAllPendingRequests("signaling disconnected");

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    producerRef.current?.close();
    producerRef.current = null;

    for (const consumer of consumersRef.current.values()) {
      consumer.close();
    }
    consumersRef.current.clear();

    sendTransportRef.current?.close();
    sendTransportRef.current = null;
    recvTransportRef.current?.close();
    recvTransportRef.current = null;

    deviceRef.current = null;
    remoteStreamRef.current = null;
    consumedProducerIdsRef.current.clear();
    queuedProducerIdsRef.current.clear();

    stopAudioStatsLoop();
    stopLocalStream();
    setActiveMeetingId(null);
    setActiveMeeting(null);
    setActiveParticipantId(null);
    setActiveParticipantName(null);
    setAgentUtterances([]);
    setMinutes(null);
    setConnectionState("new");
  }, [rejectAllPendingRequests, stopAudioStatsLoop, stopLocalStream]);

  const requestMicrophonePermission = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== "android") {
      return true;
    }

    const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
    const alreadyGranted = await PermissionsAndroid.check(permission);
    if (alreadyGranted) {
      return true;
    }

    const result = await PermissionsAndroid.request(permission);
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }, []);

  const startAudioStatsLoop = useCallback(
    (sendTransport: Transport) => {
      stopAudioStatsLoop();
      setAudioSendStatus("collecting audio stats...");

      statsIntervalRef.current = setInterval(async () => {
        try {
          const rawStats = await sendTransport.getStats();
          let reports: any[] = [];

          if (rawStats instanceof Map) {
            reports = Array.from(rawStats.values());
          } else if (Array.isArray(rawStats)) {
            reports = rawStats;
          } else if (rawStats && typeof rawStats === "object") {
            reports = Object.values(rawStats as Record<string, unknown>);
          }

          let bytesSent = 0;
          let packetsSent = 0;
          for (const report of reports) {
            if (
              report?.type === "outbound-rtp" &&
              report?.kind === "audio" &&
              report?.isRemote !== true
            ) {
              bytesSent += Number(report.bytesSent ?? 0);
              packetsSent += Number(report.packetsSent ?? 0);
            }
          }

          if (bytesSent <= 0) {
            setAudioSendStatus("connected, waiting for outbound audio packets...");
            return;
          }

          const now = Date.now();
          const previous = lastAudioBytesRef.current;
          if (!previous || now <= previous.timestampMs || bytesSent < previous.bytes) {
            lastAudioBytesRef.current = { bytes: bytesSent, timestampMs: now };
            setAudioSendStatus(`audio sent ${packetsSent} packets`);
            return;
          }

          const deltaBytes = bytesSent - previous.bytes;
          const deltaSeconds = (now - previous.timestampMs) / 1000;
          const kbps = deltaSeconds > 0 ? (deltaBytes * 8) / (deltaSeconds * 1000) : 0;
          lastAudioBytesRef.current = { bytes: bytesSent, timestampMs: now };
          setAudioSendStatus(
            `sending ${kbps.toFixed(1)} kbps (${packetsSent} packets total)`,
          );
        } catch (error) {
          const message = formatError(error, "unknown stats error");
          setAudioSendStatus(`audio stats unavailable (${message})`);
        }
      }, 1500);
    },
    [stopAudioStatsLoop],
  );

  const toggleMicrophone = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }

    const tracks = stream.getAudioTracks?.() ?? [];
    if (tracks.length === 0) {
      setMicStatus("no local audio track");
      return;
    }

    const nextEnabled = !tracks[0].enabled;
    for (const track of tracks) {
      track.enabled = nextEnabled;
    }
    setMicEnabled(nextEnabled);
    setMicStatus(nextEnabled ? "capturing" : "muted");
  }, []);

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`${HTTP_BASE_URL}/meetings`);
      if (!response.ok) {
        throw new Error(`meetings request failed: ${response.status}`);
      }
      const payload = (await response.json()) as MeetingSnapshot[];
      setMeetings(payload);
      setStatus(`loaded ${payload.length} meeting(s)`);
    } catch (error) {
      const message = formatError(error, "unknown error");
      setErrorMessage(message);
      setStatus("failed to load meetings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMeetings();
    return disconnect;
  }, [disconnect, fetchMeetings]);

  const sendRequest = useCallback(
    <T extends ServerSignal>(signal: ClientSignal): Promise<T> => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("signaling socket is not open"));
      }

      const requestId = nextRequestIdRef.current++;

      return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingRequestsRef.current.delete(requestId);
          reject(new Error(`request timed out for '${signal.type}'`));
        }, 12_000);

        pendingRequestsRef.current.set(requestId, {
          resolve: resolve as (signal: ServerSignal) => void,
          reject,
          timeout,
        });

        ws.send(
          JSON.stringify({
            request_id: requestId,
            ...signal,
          }),
        );
      });
    },
    [],
  );

  const consumeProducer = useCallback(
    async (producerId: string, meetingId: string) => {
      const device = deviceRef.current;
      const recvTransport = recvTransportRef.current;

      if (!device || !recvTransport) {
        queuedProducerIdsRef.current.add(producerId);
        return;
      }

      if (consumedProducerIdsRef.current.has(producerId)) {
        return;
      }
      consumedProducerIdsRef.current.add(producerId);

      try {
        const consumed = await sendRequest<ConsumedSignal>({
          type: "consume",
          transport_id: recvTransport.id,
          producer_id: producerId,
          rtp_capabilities: device.rtpCapabilities,
        });

        const consumer = await recvTransport.consume({
          id: consumed.consumer_id,
          producerId: consumed.producer_id,
          kind: consumed.kind,
          rtpParameters: consumed.rtp_parameters,
        });

        consumersRef.current.set(consumer.id, consumer);

        if (!remoteStreamRef.current) {
          remoteStreamRef.current = new MediaStream();
        }
        remoteStreamRef.current.addTrack(consumer.track as any);

        await sendRequest<ConsumerResumedSignal>({
          type: "resume_consumer",
          consumer_id: consumer.id,
        });

        setStatus(`receiving media in ${meetingId}`);
      } catch (error) {
        consumedProducerIdsRef.current.delete(producerId);
        const message = formatError(error, "failed to consume remote audio");
        setErrorMessage(message);
        setStatus("failed consuming remote audio");
      }
    },
    [sendRequest],
  );

  const drainQueuedProducers = useCallback(
    async (meetingId: string) => {
      const producerIds = [...queuedProducerIdsRef.current];
      queuedProducerIdsRef.current.clear();

      for (const producerId of producerIds) {
        await consumeProducer(producerId, meetingId);
      }
    },
    [consumeProducer],
  );

  const createTransport = useCallback(
    async (
      device: Device,
      direction: TransportDirection,
      meetingId: string,
    ): Promise<Transport> => {
      const created = await sendRequest<WebrtcTransportCreatedSignal>({
        type: "create_webrtc_transport",
        direction,
      });

      const transport: Transport =
        direction === "send"
          ? device.createSendTransport({
              id: created.transport_id,
              iceParameters: created.ice_parameters,
              iceCandidates: created.ice_candidates,
              dtlsParameters: created.dtls_parameters,
              sctpParameters: created.sctp_parameters,
            })
          : device.createRecvTransport({
              id: created.transport_id,
              iceParameters: created.ice_parameters,
              iceCandidates: created.ice_candidates,
              dtlsParameters: created.dtls_parameters,
              sctpParameters: created.sctp_parameters,
            });

      transport.on("connect", ({ dtlsParameters }, callback, errback) => {
        void (async () => {
          try {
            await sendRequest<TransportConnectedSignal>({
              type: "connect_webrtc_transport",
              transport_id: created.transport_id,
              dtls_parameters: dtlsParameters as DtlsParameters,
            });
            callback();
          } catch (error) {
            errback(error as Error);
          }
        })();
      });

      if (direction === "send") {
        transport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
          void (async () => {
            try {
              const produced = await sendRequest<ProducedSignal>({
                type: "produce",
                transport_id: created.transport_id,
                kind: kind as MediaKind,
                rtp_parameters: rtpParameters as RtpParameters,
              });
              callback({ id: produced.producer_id });
            } catch (error) {
              errback(error as Error);
            }
          })();
        });
      }

      transport.on("connectionstatechange", (state) => {
        setConnectionState(state);
        setStatus(`webrtc ${state} (${meetingId}, ${direction})`);
      });

      return transport;
    },
    [sendRequest],
  );

  const handleServerEvent = useCallback(
    (signal: ServerSignal, meetingId: string) => {
      if (signal.type === "new_producer") {
        void consumeProducer(signal.producer_id, meetingId);
        return;
      }
      if (signal.type === "peer_left") {
        setStatus(`peer ${signal.peer_id} left ${meetingId}`);
        return;
      }
      if (signal.type === "meeting_snapshot") {
        setActiveMeeting(signal.meeting);
        return;
      }
      if (signal.type === "agent_text") {
        setAgentUtterances((current) => [
          ...current,
          {
            utterance_id: signal.utterance_id,
            participant_id: signal.participant_id,
            participant_name: signal.participant_name,
            text: signal.text,
          },
        ]);
        setStatus(`${signal.participant_name} responded`);
        return;
      }
      if (signal.type === "meeting_ended") {
        setStatus(`meeting ended at ${signal.ended_at}`);
        setActiveMeeting((current) =>
          current
            ? { ...current, state: "ended", ended_at: signal.ended_at }
            : current,
        );
        return;
      }
      if (signal.type === "minutes_ready") {
        setMinutes(signal.minutes);
        setStatus("minutes generated");
        return;
      }
      if (signal.type === "error") {
        setErrorMessage(signal.message);
        setStatus("server rejected signaling message");
      }
    },
    [consumeProducer],
  );

  const joinMeeting = useCallback(
    async (meeting: MeetingSnapshot) => {
      const participant = joinableParticipant(meeting);
      if (!participant) {
        setErrorMessage("no human participant is available to join this meeting");
        setStatus("cannot join meeting");
        return;
      }

      disconnect();
      setErrorMessage(null);
      setMinutes(null);
      setAgentUtterances([]);
      setStatus(`connecting to ${meeting.title}...`);
      setConnectionState("connecting");
      setMicStatus("requesting microphone...");
      setAudioSendStatus("not sending");

      const ws = new WebSocket(SIGNAL_URL);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (typeof event.data !== "string") {
          return;
        }

        let envelope: ServerEnvelope;
        try {
          envelope = JSON.parse(event.data) as ServerEnvelope;
        } catch (error) {
          const message = formatError(error, "failed to parse signal payload");
          setErrorMessage(message);
          return;
        }

        const requestId = envelope.request_id;
        if (typeof requestId === "number") {
          const pending = pendingRequestsRef.current.get(requestId);
          if (!pending) {
            return;
          }

          pendingRequestsRef.current.delete(requestId);
          clearTimeout(pending.timeout);

          if (envelope.type === "error") {
            pending.reject(new Error(envelope.message));
          } else {
            pending.resolve(envelope);
          }
          return;
        }

        handleServerEvent(envelope, meeting.meeting_id);
      };

      ws.onerror = () => {
        setStatus("websocket error");
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          disconnect();
          setStatus("disconnected");
        }
      };

      ws.onopen = async () => {
        try {
          const micAllowed = await requestMicrophonePermission();
          if (!micAllowed) {
            throw new Error("microphone permission denied");
          }

          const stream = await mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
          const audioTracks = stream.getAudioTracks?.() ?? [];
          if (audioTracks.length === 0) {
            throw new Error("microphone stream has no audio tracks");
          }

          localStreamRef.current = stream;
          setMicEnabled(audioTracks.every((track: any) => track.enabled !== false));
          setMicStatus("capturing");

          if (!globalsRegisteredRef.current) {
            registerGlobals();
            globalsRegisteredRef.current = true;
          }

          const device = new Device({ handlerName: "ReactNative106" });
          deviceRef.current = device;

          const joined = await sendRequest<MeetingJoinedSignal>({
            type: "join_meeting",
            meeting_id: meeting.meeting_id,
            participant_id: participant.participant_id,
          });

          await device.load({
            routerRtpCapabilities: joined.router_rtp_capabilities,
          });

          const sendTransport = await createTransport(device, "send", meeting.meeting_id);
          const recvTransport = await createTransport(device, "recv", meeting.meeting_id);

          sendTransportRef.current = sendTransport;
          recvTransportRef.current = recvTransport;

          setActiveMeetingId(joined.meeting.meeting_id);
          setActiveMeeting(joined.meeting);
          setActiveParticipantId(joined.participant_id);
          setActiveParticipantName(participant.name);
          setStatus(`joined ${joined.meeting.title} as ${participant.name}`);

          startAudioStatsLoop(sendTransport);

          if (!device.canProduce("audio")) {
            throw new Error("this device cannot produce audio");
          }

          const producer = await sendTransport.produce({
            track: audioTracks[0],
          });
          producerRef.current = producer as Producer;

          setStatus(`sending audio in ${joined.meeting.title}`);

          for (const producerId of joined.existing_producer_ids) {
            await consumeProducer(producerId, joined.meeting.meeting_id);
          }

          await drainQueuedProducers(joined.meeting.meeting_id);
        } catch (error) {
          const message = formatError(error, "unknown connect error");
          setErrorMessage(message);
          setStatus("connection failed");
          disconnect();
        }
      };
    },
    [
      consumeProducer,
      createTransport,
      disconnect,
      drainQueuedProducers,
      handleServerEvent,
      requestMicrophonePermission,
      sendRequest,
      startAudioStatsLoop,
    ],
  );

  const leaveMeeting = useCallback(() => {
    setStatus("left meeting");
    disconnect();
  }, [disconnect]);

  const endMeeting = useCallback(async () => {
    if (!activeMeetingId) {
      return;
    }
    try {
      await sendRequest<MeetingEndedSignal>({
        type: "end_meeting",
        meeting_id: activeMeetingId,
      });
    } catch (error) {
      const message = formatError(error, "failed to end meeting");
      setErrorMessage(message);
      setStatus("failed to end meeting");
    }
  }, [activeMeetingId, sendRequest]);

  const isOwner =
    activeMeeting &&
    activeParticipantId &&
    activeMeeting.owner_participant_id === activeParticipantId;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Workinabox</Text>
          <Text style={styles.subtitle}>Backend: {HTTP_BASE_URL}</Text>
          <Text style={styles.status}>Status: {status}</Text>
          {errorMessage ? <Text style={styles.error}>Error: {errorMessage}</Text> : null}
        </View>

        {activeMeeting ? (
          <ScrollView contentContainerStyle={styles.meetingScreen}>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>{activeMeeting.title}</Text>
              <Text style={styles.status}>Meeting ID: {activeMeetingId}</Text>
              <Text style={styles.status}>State: {activeMeeting.state}</Text>
              <Text style={styles.status}>Connection: {connectionState}</Text>
              <Text style={styles.status}>Joined as: {activeParticipantName ?? "unknown"}</Text>
              <Text style={styles.status}>Mic: {micStatus}</Text>
              <Text style={styles.status}>Outbound audio: {audioSendStatus}</Text>
            </View>

            <View style={styles.actions}>
              <Pressable style={styles.button} onPress={toggleMicrophone}>
                <Text style={styles.buttonText}>{micEnabled ? "Mute Mic" : "Unmute Mic"}</Text>
              </Pressable>
              {isOwner ? (
                <Pressable style={styles.warningButton} onPress={() => void endMeeting()}>
                  <Text style={styles.buttonText}>End Meeting</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.dangerButton} onPress={leaveMeeting}>
                <Text style={styles.buttonText}>Leave Meeting</Text>
              </Pressable>
            </View>

            <View style={styles.panel}>
              <Text style={styles.sectionTitle}>Agenda</Text>
              {activeMeeting.agenda.map((item) => (
                <Text key={item.agenda_item_id} style={styles.listItem}>
                  • {item.phrase}
                </Text>
              ))}
            </View>

            <View style={styles.panel}>
              <Text style={styles.sectionTitle}>Participants</Text>
              {activeMeeting.participants.map((participant) => (
                <Text key={participant.participant_id} style={styles.listItem}>
                  • {participant.name} ({participant.kind}, {participant.meeting_role})
                </Text>
              ))}
            </View>

            <View style={styles.panel}>
              <Text style={styles.sectionTitle}>Agent Responses</Text>
              {agentUtterances.length === 0 ? (
                <Text style={styles.empty}>No agent responses yet.</Text>
              ) : (
                agentUtterances.map((utterance) => (
                  <View key={utterance.utterance_id} style={styles.agentCard}>
                    <Text style={styles.agentName}>{utterance.participant_name}</Text>
                    <Text style={styles.agentText}>{utterance.text}</Text>
                  </View>
                ))
              )}
            </View>

            <View style={styles.panel}>
              <Text style={styles.sectionTitle}>Minutes</Text>
              {minutes ? (
                <>
                  <Text style={styles.status}>Owner: {minutes.owner_name}</Text>
                  <Text style={styles.status}>Moderator: {minutes.moderator_name}</Text>
                  <Text style={styles.status}>Ended: {minutes.ended_at}</Text>
                  {minutes.agenda.map((item) => (
                    <View key={item.agenda_item_id} style={styles.minutesItem}>
                      <Text style={styles.minutesTitle}>{item.phrase}</Text>
                      {item.decisions.length > 0 ? (
                        item.decisions.map((decision, index) => (
                          <Text key={`${item.agenda_item_id}-${index}`} style={styles.listItem}>
                            • {decision}
                          </Text>
                        ))
                      ) : (
                        <Text style={styles.empty}>No recorded decisions.</Text>
                      )}
                    </View>
                  ))}
                </>
              ) : (
                <Text style={styles.empty}>Minutes will appear after the meeting ends.</Text>
              )}
            </View>
          </ScrollView>
        ) : (
          <>
            <View style={styles.actions}>
              <Pressable style={styles.button} onPress={() => void fetchMeetings()}>
                <Text style={styles.buttonText}>Refresh Meetings</Text>
              </Pressable>
            </View>

            {loading ? (
              <ActivityIndicator size="large" />
            ) : (
              <FlatList
                data={meetings}
                keyExtractor={(meeting) => meeting.meeting_id}
                contentContainerStyle={styles.meetingList}
                renderItem={({ item }) => {
                  const participant = joinableParticipant(item);
                  return (
                    <Pressable
                      style={styles.meetingCard}
                      onPress={() => {
                        void joinMeeting(item);
                      }}
                    >
                      <Text style={styles.meetingName}>{item.title}</Text>
                      <Text style={styles.meetingMeta}>
                        {item.participants.length} participant(s) • {item.agenda.length} agenda
                        item(s)
                      </Text>
                      <Text style={styles.meetingMeta}>
                        Join as: {participant ? participant.name : "no human available"}
                      </Text>
                      <Text style={styles.meetingAction}>Tap to join</Text>
                    </Pressable>
                  );
                }}
                ListEmptyComponent={<Text style={styles.empty}>No meetings found.</Text>}
              />
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f4f6f8",
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  header: {
    marginBottom: 16,
    gap: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#1b1f24",
  },
  subtitle: {
    fontSize: 12,
    color: "#59636e",
  },
  status: {
    fontSize: 14,
    color: "#2f3b4a",
  },
  error: {
    marginTop: 4,
    color: "#9f1a1a",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  },
  button: {
    backgroundColor: "#1f6feb",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  warningButton: {
    backgroundColor: "#d97706",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  dangerButton: {
    backgroundColor: "#cf222e",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "600",
  },
  meetingScreen: {
    gap: 12,
    paddingBottom: 32,
  },
  panel: {
    backgroundColor: "#ffffff",
    borderColor: "#d0d7de",
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  panelTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1f2328",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1f2328",
  },
  meetingList: {
    gap: 10,
    paddingBottom: 24,
  },
  meetingCard: {
    backgroundColor: "#ffffff",
    padding: 14,
    borderRadius: 12,
    borderColor: "#d0d7de",
    borderWidth: 1,
    gap: 4,
  },
  meetingName: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1f2328",
  },
  meetingMeta: {
    fontSize: 13,
    color: "#59636e",
  },
  meetingAction: {
    marginTop: 6,
    fontSize: 12,
    color: "#1f6feb",
  },
  listItem: {
    color: "#2f3b4a",
    fontSize: 14,
  },
  agentCard: {
    borderRadius: 10,
    backgroundColor: "#f6f8fa",
    padding: 12,
    gap: 4,
  },
  agentName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1f2328",
  },
  agentText: {
    fontSize: 14,
    color: "#2f3b4a",
  },
  minutesItem: {
    gap: 6,
    paddingTop: 6,
  },
  minutesTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1f2328",
  },
  empty: {
    color: "#59636e",
    fontSize: 14,
  },
});
