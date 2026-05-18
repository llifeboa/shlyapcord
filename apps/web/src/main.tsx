import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Headphones, Mic, MicOff, PhoneOff, Settings, Users } from "lucide-react";
import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import rnnoiseWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import rnnoiseWorkletPath from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import "./styles.css";

type User = {
  id: string;
  name: string;
  joinedAt: string;
  inVoice: boolean;
  muted: boolean;
};

type ServerMessage = {
  type: string;
  payload: any;
};

type IceConfig = {
  iceServers: RTCIceServer[];
};

type RemoteAudio = {
  audio: HTMLAudioElement;
  context?: AudioContext;
  source?: MediaStreamAudioSourceNode;
  gain?: GainNode;
};

type NoiseMode = "rnnoise" | "browser";
type PeerStatus = {
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
};

type PeerMetric = {
  rttMs?: number;
  packetsLost?: number;
  packetsReceived?: number;
  localCandidateType?: string;
  remoteCandidateType?: string;
};

const inviteToken = readInviteToken();
const DEFAULT_VOICE_ROOM_NAME = "Голосовая комната";
const MIC_GAIN_PERCENT = 1000;
const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: 48000
  },
  video: false
};

function App() {
  const [name, setName] = useState("");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [status, setStatus] = useState("Ожидание входа");
  const [error, setError] = useState<string | null>(null);
  const [inVoice, setInVoice] = useState(false);
  const [muted, setMuted] = useState(false);
  const [iceConfig, setIceConfig] = useState<IceConfig>({ iceServers: [] });
  const [noiseStatus, setNoiseStatus] = useState("RNNoise");
  const [noiseMode, setNoiseMode] = useState<NoiseMode>("rnnoise");
  const [userVolumes, setUserVolumes] = useState<Record<string, number>>({});
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voiceDetailsOpen, setVoiceDetailsOpen] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<"checking" | "valid" | "forbidden">(
    inviteToken ? "checking" : "forbidden"
  );
  const [voiceStatus, setVoiceStatus] = useState("Not connected");
  const [peerStatuses, setPeerStatuses] = useState<Record<string, PeerStatus>>({});
  const [peerMetrics, setPeerMetrics] = useState<Record<string, PeerMetric>>({});
  const socketRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rnnoiseNodeRef = useRef<RnnoiseWorkletNode | null>(null);
  const micGainNodeRef = useRef<GainNode | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteAudioRefs = useRef<Map<string, RemoteAudio>>(new Map());

  const voiceUsers = useMemo(() => users.filter((user) => user.inVoice), [users]);
  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, users]
  );

  useEffect(() => {
    fetch("/api/ice")
      .then((response) => response.json())
      .then((config: IceConfig) => setIceConfig(config))
      .catch(() => setIceConfig({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }));

    if (inviteToken) {
      fetch(`/api/invites/${encodeURIComponent(inviteToken)}`)
        .then((response) => response.json())
        .then((payload: { valid: boolean }) => setInviteStatus(payload.valid ? "valid" : "forbidden"))
        .catch(() => setInviteStatus("forbidden"));
    }

    return () => {
      leaveVoice();
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!inVoice) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshPeerMetrics();
    }, 2000);
    void refreshPeerMetrics();

    return () => window.clearInterval(interval);
  }, [inVoice]);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!inviteToken) {
      setError("Invite token отсутствует в ссылке");
      return;
    }
    if (!name.trim()) {
      setError("Введите имя");
      return;
    }

    const socket = new WebSocket(webSocketUrl());
    socketRef.current = socket;
    setStatus("Подключение");

    socket.addEventListener("open", () => {
      send("auth.join", {
        inviteToken,
        name: name.trim()
      });
    });

    socket.addEventListener("message", async (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      await handleServerMessage(message);
    });

    socket.addEventListener("close", () => {
      setStatus("Соединение закрыто");
      setInVoice(false);
      closePeers();
    });

    socket.addEventListener("error", () => {
      setError("Ошибка WebSocket-соединения");
      setStatus("Ошибка");
    });
  }

  async function handleServerMessage(message: ServerMessage) {
    switch (message.type) {
      case "auth.ok":
        setCurrentUser(message.payload.user);
        setStatus("Онлайн");
        break;
      case "auth.error":
      case "error":
        setError(message.payload.message);
        break;
      case "users.list":
        setUsers(message.payload.users);
        break;
      case "voice.users":
        await createOffersFor(message.payload.users);
        break;
      case "voice.userLeft":
      case "user.left":
        closePeer(message.payload.userId);
        break;
      case "webrtc.offer":
        await handleOffer(message.payload.sourceUserId, message.payload.payload);
        break;
      case "webrtc.answer":
        await handleAnswer(message.payload.sourceUserId, message.payload.payload);
        break;
      case "webrtc.iceCandidate":
        await handleIceCandidate(message.payload.sourceUserId, message.payload.payload);
        break;
    }
  }

  async function joinVoice() {
    setError(null);
    try {
      setVoiceStatus("Requesting microphone");
      const stream = await createLocalAudioStream();
      localStreamRef.current = stream;
      setVoiceStatus("Joining voice");
      setInVoice(true);
      send("voice.join", {});
    } catch {
      setVoiceStatus("Microphone denied");
      setError("Не удалось получить доступ к микрофону");
    }
  }

  function leaveVoice() {
    send("voice.leave", {});
    setInVoice(false);
    setMuted(false);
    setVoiceStatus("Not connected");
    setPeerStatuses({});
    setPeerMetrics({});
    stopLocalAudio();
    closePeers();
  }

  function toggleMute() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    send("voice.mute", { muted: nextMuted });
  }

  async function createOffersFor(remoteUsers: User[]) {
    for (const remoteUser of remoteUsers) {
      const peer = createPeer(remoteUser.id);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      send("webrtc.offer", offer, remoteUser.id);
    }
  }

  async function handleOffer(sourceUserId: string, offer: RTCSessionDescriptionInit) {
    if (!localStreamRef.current) {
      const stream = await createLocalAudioStream();
      localStreamRef.current = stream;
      setInVoice(true);
    }

    const peer = createPeer(sourceUserId);
    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    send("webrtc.answer", answer, sourceUserId);
  }

  async function handleAnswer(sourceUserId: string, answer: RTCSessionDescriptionInit) {
    const peer = peersRef.current.get(sourceUserId);
    if (!peer) {
      return;
    }
    await peer.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async function handleIceCandidate(sourceUserId: string, candidate: RTCIceCandidateInit) {
    const peer = peersRef.current.get(sourceUserId);
    if (!peer || !candidate) {
      return;
    }
    await peer.addIceCandidate(new RTCIceCandidate(candidate));
  }

  function createPeer(remoteUserId: string) {
    const existing = peersRef.current.get(remoteUserId);
    if (existing) {
      return existing;
    }

    const peer = new RTCPeerConnection(iceConfig);
    updatePeerStatus(remoteUserId, peer);
    localStreamRef.current?.getTracks().forEach((track) => {
      peer.addTrack(track, localStreamRef.current!);
    });

    peer.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        send("webrtc.iceCandidate", event.candidate.toJSON(), remoteUserId);
      }
    });

    peer.addEventListener("track", (event) => {
      const [stream] = event.streams;
      attachRemoteAudio(remoteUserId, stream);
    });

    peer.addEventListener("connectionstatechange", () => {
      updatePeerStatus(remoteUserId, peer);
      if (["failed", "closed"].includes(peer.connectionState)) {
        closePeer(remoteUserId);
      }
    });

    peer.addEventListener("iceconnectionstatechange", () => {
      updatePeerStatus(remoteUserId, peer);
    });

    peersRef.current.set(remoteUserId, peer);
    return peer;
  }

  function closePeer(userId: string) {
    peersRef.current.get(userId)?.close();
    peersRef.current.delete(userId);

    const remoteAudio = remoteAudioRefs.current.get(userId);
    if (remoteAudio) {
      remoteAudio.audio.srcObject = null;
      remoteAudio.audio.remove();
      remoteAudio.source?.disconnect();
      remoteAudio.gain?.disconnect();
      remoteAudio.context?.close();
    }
    remoteAudioRefs.current.delete(userId);
    setPeerStatuses((previous) => {
      const next = { ...previous };
      delete next[userId];
      return next;
    });
    setPeerMetrics((previous) => {
      const next = { ...previous };
      delete next[userId];
      return next;
    });
  }

  function closePeers() {
    for (const userId of Array.from(peersRef.current.keys())) {
      closePeer(userId);
    }
  }

  function send(type: string, payload: unknown, targetUserId?: string) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify({ type, targetUserId, payload }));
  }

  function attachRemoteAudio(userId: string, stream: MediaStream) {
    const volume = userVolumes[userId] ?? 100;
    const existing = remoteAudioRefs.current.get(userId);
    if (existing) {
      existing.audio.srcObject = stream;
      applyRemoteVolume(userId, volume);
      return;
    }

    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.srcObject = stream;

    try {
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      source.connect(gain).connect(context.destination);
      gain.gain.value = volume / 100;
      void context.resume();
      audio.muted = true;
      remoteAudioRefs.current.set(userId, { audio, context, source, gain });
    } catch (error) {
      console.warn("Remote gain node failed, using element volume", error);
      audio.volume = Math.min(volume, 100) / 100;
      remoteAudioRefs.current.set(userId, { audio });
    }
  }

  function changeUserVolume(userId: string, volume: number) {
    setUserVolumes((previous) => ({ ...previous, [userId]: volume }));
    applyRemoteVolume(userId, volume);
  }

  function applyRemoteVolume(userId: string, volume: number) {
    const remoteAudio = remoteAudioRefs.current.get(userId);
    if (!remoteAudio) {
      return;
    }

    if (remoteAudio.gain) {
      remoteAudio.gain.gain.value = volume / 100;
    } else {
      remoteAudio.audio.volume = Math.min(volume, 100) / 100;
    }
  }

  async function createLocalAudioStream() {
    const rawStream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
    rawStreamRef.current = rawStream;

    if (noiseMode === "browser") {
      setNoiseStatus("Browser audio");
      return createGainOnlyStream(rawStream);
    }

    try {
      if (!("AudioWorkletNode" in window)) {
        throw new Error("AudioWorklet is not supported");
      }

      setVoiceStatus(noiseMode === "rnnoise" ? "Loading RNNoise" : "Loading audio filter");
      const audioContext = new AudioContext({ sampleRate: 48000 });
      audioContextRef.current = audioContext;
      await audioContext.resume();

      return await createRnnoiseStream(rawStream, audioContext);
    } catch (error) {
      console.warn("Noise filter failed, using browser audio with gain", error);
      setNoiseStatus("Browser audio");
      setVoiceStatus("Noise filter fallback");
      return createGainOnlyStream(rawStream);
    }
  }

  async function createRnnoiseStream(rawStream: MediaStream, audioContext: AudioContext) {
    const wasmBinary = await loadRnnoise({
      url: rnnoiseWasmPath,
      simdUrl: rnnoiseSimdWasmPath
    });
    await audioContext.audioWorklet.addModule(rnnoiseWorkletPath);

    const source = audioContext.createMediaStreamSource(rawStream);
    const rnnoise = new RnnoiseWorkletNode(audioContext, {
      wasmBinary,
      maxChannels: 1
    });
    const micGain = audioContext.createGain();
    const destination = audioContext.createMediaStreamDestination();

    micGain.gain.value = MIC_GAIN_PERCENT / 100;
    source.connect(rnnoise).connect(micGain).connect(destination);
    rnnoiseNodeRef.current = rnnoise;
    micGainNodeRef.current = micGain;
    setNoiseStatus("RNNoise");

    return destination.stream;
  }

  function createGainOnlyStream(rawStream: MediaStream) {
    const audioContext = new AudioContext({ sampleRate: 48000 });
    const source = audioContext.createMediaStreamSource(rawStream);
    const micGain = audioContext.createGain();
    const destination = audioContext.createMediaStreamDestination();
    micGain.gain.value = MIC_GAIN_PERCENT / 100;
    source.connect(micGain).connect(destination);
    audioContextRef.current = audioContext;
    micGainNodeRef.current = micGain;
    return destination.stream;
  }

  function stopLocalAudio() {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    rawStreamRef.current?.getTracks().forEach((track) => track.stop());
    rnnoiseNodeRef.current?.destroy();
    micGainNodeRef.current?.disconnect();
    audioContextRef.current?.close();
    localStreamRef.current = null;
    rawStreamRef.current = null;
    rnnoiseNodeRef.current = null;
    micGainNodeRef.current = null;
    audioContextRef.current = null;
  }

  function updatePeerStatus(userId: string, peer: RTCPeerConnection) {
    setPeerStatuses((previous) => ({
      ...previous,
      [userId]: {
        connectionState: peer.connectionState,
        iceConnectionState: peer.iceConnectionState
      }
    }));
  }

  function connectedPeerCount() {
    return Object.values(peerStatuses).filter((status) => status.connectionState === "connected").length;
  }

  function totalPeerCount() {
    return Object.keys(peerStatuses).length;
  }

  function voiceDetails() {
    if (!inVoice) {
      return "Not connected";
    }
    return `${voiceStatus} · ${connectedPeerCount()}/${totalPeerCount()} peers · ${noiseStatus}`;
  }

  async function refreshPeerMetrics() {
    const entries = Array.from(peersRef.current.entries());
    const updates = await Promise.all(
      entries.map(async ([userId, peer]) => [userId, await readPeerMetric(peer)] as const)
    );

    setPeerMetrics((previous) => {
      const next = { ...previous };
      for (const [userId, metric] of updates) {
        next[userId] = metric;
      }
      return next;
    });
  }

  async function readPeerMetric(peer: RTCPeerConnection): Promise<PeerMetric> {
    const report = await peer.getStats();
    let selectedPair: any;
    let inboundAudio: any;
    let selectedPairId: string | undefined;

    report.forEach((stat: any) => {
      if (stat.type === "transport" && stat.selectedCandidatePairId) {
        selectedPairId = stat.selectedCandidatePairId;
      }
      if (stat.type === "candidate-pair" && (stat.selected || stat.nominated) && stat.state === "succeeded") {
        selectedPair = stat;
      }
      if (stat.type === "inbound-rtp" && (stat.kind === "audio" || stat.mediaType === "audio") && !stat.isRemote) {
        inboundAudio = stat;
      }
    });
    if (!selectedPair && selectedPairId) {
      selectedPair = report.get(selectedPairId);
    }

    const localCandidate = selectedPair?.localCandidateId ? report.get(selectedPair.localCandidateId) as any : undefined;
    const remoteCandidate = selectedPair?.remoteCandidateId ? report.get(selectedPair.remoteCandidateId) as any : undefined;

    return {
      rttMs: selectedPair?.currentRoundTripTime != null ? Math.round(selectedPair.currentRoundTripTime * 1000) : undefined,
      packetsLost: inboundAudio?.packetsLost,
      packetsReceived: inboundAudio?.packetsReceived,
      localCandidateType: localCandidate?.candidateType,
      remoteCandidateType: remoteCandidate?.candidateType
    };
  }

  function averagePingMs() {
    const values = Object.values(peerMetrics)
      .map((metric) => metric.rttMs)
      .filter((value): value is number => typeof value === "number");
    if (values.length === 0) {
      return undefined;
    }
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }

  function lastPingMs() {
    const values = Object.values(peerMetrics)
      .map((metric) => metric.rttMs)
      .filter((value): value is number => typeof value === "number");
    return values[values.length - 1];
  }

  function outboundPacketLossRate() {
    const totals = Object.values(peerMetrics).reduce(
      (acc, metric) => {
        acc.lost += Math.max(0, metric.packetsLost ?? 0);
        acc.received += Math.max(0, metric.packetsReceived ?? 0);
        return acc;
      },
      { lost: 0, received: 0 }
    );
    const total = totals.lost + totals.received;
    if (total === 0) {
      return undefined;
    }
    return (totals.lost / total) * 100;
  }

  function connectionType() {
    const candidateTypes = Object.values(peerMetrics).flatMap((metric) => [
      metric.localCandidateType,
      metric.remoteCandidateType
    ]);
    if (candidateTypes.includes("relay")) {
      return "TURN relay";
    }
    if (candidateTypes.includes("srflx")) {
      return "Direct NAT traversal";
    }
    if (candidateTypes.includes("host")) {
      return "Direct local";
    }
    return "Unknown";
  }

  function voiceQuality() {
    const ping = averagePingMs();
    const loss = outboundPacketLossRate();
    if (ping == null && loss == null) {
      return "good";
    }
    if ((ping ?? 0) >= 250 || (loss ?? 0) >= 10) {
      return "bad";
    }
    if ((ping ?? 0) >= 120 || (loss ?? 0) >= 3) {
      return "warn";
    }
    return "good";
  }

  function voiceConnectionTitle() {
    if (voiceStatus !== "Joining voice" && voiceStatus !== "Not connected") {
      return voiceStatus;
    }
    if (connectedPeerCount() === totalPeerCount() && totalPeerCount() > 0) {
      return "Voice Connected";
    }
    if (totalPeerCount() > 0) {
      return "Connecting";
    }
    return "Voice Connected";
  }

  function voiceConnectionSubtitle() {
    if (["Requesting microphone", "Loading RNNoise", "Joining voice", "Noise filter fallback"].includes(voiceStatus)) {
      return voiceStatus;
    }
    const ping = averagePingMs();
    const loss = outboundPacketLossRate();
    if (ping == null) {
      return DEFAULT_VOICE_ROOM_NAME;
    }
    return `${connectionType()} · ${ping} ms · ${loss?.toFixed(1) ?? "0.0"}% loss`;
  }

  if (!currentUser) {
    if (inviteStatus === "checking") {
      return (
        <main className="shell login-shell">
          <section className="forbidden-panel">
            <p className="eyebrow">Shlyapcord</p>
            <h1>Checking invite</h1>
          </section>
        </main>
      );
    }

    if (inviteStatus === "forbidden") {
      return (
        <main className="shell login-shell">
          <section className="forbidden-panel">
            <p className="eyebrow">Shlyapcord</p>
            <h1>403 Forbidden</h1>
          </section>
        </main>
      );
    }

    return (
      <main className="shell login-shell">
        <section className="login-panel">
          <div>
            <p className="eyebrow">Shlyapcord</p>
            <h1>Вход в голосовую комнату</h1>
            <p className="muted">
              Invite: <span>{inviteToken || "не найден"}</span>
            </p>
          </div>

          <form onSubmit={handleLogin} className="login-form">
            <label>
              Имя
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} autoFocus />
            </label>
            <button type="submit">Войти</button>
          </form>

          <StatusLine status={status} error={error} />
        </section>
      </main>
    );
  }

  return (
    <main className="shell app-shell">
      <nav className="server-rail" aria-label="Servers">
        <div className="server-icon">S</div>
      </nav>

      <aside className="channel-sidebar">
        <div>
          <p className="eyebrow">Shlyapcord</p>
          <h1>{DEFAULT_VOICE_ROOM_NAME}</h1>
        </div>

        <section className="channel-group">
          <div className="channel-title">Комната по умолчанию</div>
          <button className={inVoice ? "channel-row active" : "channel-row"} onClick={inVoice ? undefined : joinVoice}>
            <Users size={17} />
            {DEFAULT_VOICE_ROOM_NAME}
            <span>{voiceUsers.length}</span>
          </button>
          <div className="channel-voice-users">
            {voiceUsers.map((user) => (
              <button className="channel-voice-user" key={user.id} onClick={() => setSelectedUserId(user.id)}>
                <div className="channel-voice-avatar">{user.name.slice(0, 1).toUpperCase()}</div>
                <span>{user.name}</span>
                {user.muted && <MicOff size={14} />}
              </button>
            ))}
          </div>
        </section>

        <div className="sidebar-bottom">
          {inVoice && (
            <button className={`voice-connection-card quality-${voiceQuality()}`} onClick={() => setVoiceDetailsOpen(true)}>
              <div>
                <div className="voice-connection-title">{voiceConnectionTitle()}</div>
                <div className="voice-connection-room">{voiceConnectionSubtitle()}</div>
              </div>
              <span className="icon-button danger voice-disconnect" onClick={(event) => {
                event.stopPropagation();
                leaveVoice();
              }} title="Выйти из голоса">
                <PhoneOff size={18} />
              </span>
            </button>
          )}

          <div className="user-control-bar">
            <div className="user-mini">
              <div className="user-mini-avatar">{currentUser.name.slice(0, 1).toUpperCase()}</div>
              <div>
                <strong>{currentUser.name}</strong>
                <span>{error || status}</span>
              </div>
            </div>
            <div className="user-control-actions">
              <button className="icon-button" onClick={toggleMute} disabled={!inVoice} title={muted ? "Включить микрофон" : "Выключить микрофон"}>
                {muted ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
              <button className="icon-button" disabled title="Наушники">
                <Headphones size={18} />
              </button>
              <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Настройки">
                <Settings size={18} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      <section className="content">
        <header className="content-header">
          <div>
            <p className="eyebrow">Голосовой канал</p>
            <h2>{DEFAULT_VOICE_ROOM_NAME}</h2>
          </div>
          <div className="current-user">{currentUser.name}</div>
        </header>

        <div className="voice-stage">
          {voiceUsers.length === 0 ? (
            <div className="empty-voice">
              <Mic size={28} />
              <h3>В голосовом канале пока пусто</h3>
            </div>
          ) : (
            voiceUsers.map((user) => (
              <article className="voice-tile" key={user.id}>
                <div className="voice-avatar">{user.name.slice(0, 1).toUpperCase()}</div>
                <h3>{user.name}</h3>
                <div className="voice-state">
                  {user.muted ? <MicOff size={16} /> : <Mic size={16} />}
                  {user.muted ? "Muted" : "Speaking ready"}
                </div>
              </article>
            ))
          )}
        </div>

        <footer className="voice-footer">
          <span>{voiceUsers.length} в голосе</span>
          <span>WebRTC media encrypted with DTLS-SRTP</span>
        </footer>
      </section>

      <aside className="member-sidebar">
        <div className="member-heading">Онлайн - {users.length}</div>
        <div className="member-list">
          {users.map((user) => (
            <article
              className={user.inVoice ? "user-card in-voice clickable" : "user-card"}
              key={user.id}
              onClick={user.inVoice ? () => setSelectedUserId(user.id) : undefined}
            >
              <div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div>
              <div>
                <h3>{user.name}</h3>
                <p>{user.inVoice ? "В голосовой комнате" : "Онлайн"}</p>
              </div>
              <div className="user-icons">
                {user.inVoice && <Users size={17} />}
                {user.muted && <MicOff size={17} />}
              </div>
            </article>
          ))}
        </div>
      </aside>

      {selectedUser && (
        <div className="modal-backdrop" onClick={() => setSelectedUserId(null)}>
          <section className="user-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-user-header">
              <div className="voice-avatar">{selectedUser.name.slice(0, 1).toUpperCase()}</div>
              <div>
                <h3>{selectedUser.name}</h3>
                <p>{selectedUser.muted ? "Muted" : "В голосовой комнате"}</p>
                {selectedUser.id !== currentUser.id && (
                  <p>
                    Connection: {peerStatuses[selectedUser.id]?.connectionState ?? "not connected"} · ICE:{" "}
                    {peerStatuses[selectedUser.id]?.iceConnectionState ?? "new"}
                  </p>
                )}
              </div>
            </div>

            {selectedUser.id !== currentUser.id ? (
              <label className="modal-volume-control">
                <span>Громкость: {userVolumes[selectedUser.id] ?? 100}%</span>
                <input
                  aria-label={`Volume for ${selectedUser.name}`}
                  max={200}
                  min={0}
                  onChange={(event) => changeUserVolume(selectedUser.id, Number(event.target.value))}
                  step={5}
                  type="range"
                  value={userVolumes[selectedUser.id] ?? 100}
                />
              </label>
            ) : (
              <p className="modal-note">Это вы.</p>
            )}

            <button className="modal-close" onClick={() => setSelectedUserId(null)}>
              Закрыть
            </button>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <section className="settings-modal" onClick={(event) => event.stopPropagation()}>
            <div>
              <h3>Настройки</h3>
              <p>Аудио</p>
            </div>

            <label className="settings-field">
              <span>Noise filter</span>
              <select
                disabled={inVoice}
                onChange={(event) => setNoiseMode(event.target.value as NoiseMode)}
                value={noiseMode}
              >
                <option value="rnnoise">RNNoise</option>
                <option value="browser">Browser audio</option>
              </select>
            </label>

            {inVoice && <p className="modal-note">Фильтр можно менять только до входа в голос.</p>}

            <button className="modal-close" onClick={() => setSettingsOpen(false)}>
              Закрыть
            </button>
          </section>
        </div>
      )}

      {voiceDetailsOpen && (
        <div className="modal-backdrop" onClick={() => setVoiceDetailsOpen(false)}>
          <section className="voice-details-modal" onClick={(event) => event.stopPropagation()}>
            <div>
              <h3>Voice Details</h3>
              <div className="voice-details-tabs">
                <span>Connection</span>
                <span>Privacy</span>
              </div>
            </div>

            <div className="voice-detail-stats">
              <p>Average ping: <strong>{averagePingMs() ?? "n/a"}{averagePingMs() != null ? " ms" : ""}</strong></p>
              <p>Last ping: <strong>{lastPingMs() ?? "n/a"}{lastPingMs() != null ? " ms" : ""}</strong></p>
              <p>Packet loss rate: <strong>{outboundPacketLossRate()?.toFixed(1) ?? "n/a"}{outboundPacketLossRate() != null ? "%" : ""}</strong></p>
              <p>Connection type: <strong>{connectionType()}</strong></p>
              <p>Connections: <strong>{connectedPeerCount()}/{totalPeerCount()}</strong></p>
              <p>Noise filter: <strong>{noiseStatus}</strong></p>
            </div>

            <p className="voice-detail-help">
              If voice is delayed, robotic, or users cannot hear each other, check participant connection states in the user modal.
            </p>

            <div className="voice-detail-encryption">End-to-end encrypted</div>
          </section>
        </div>
      )}
    </main>
  );
}

function StatusLine({ status, error }: { status: string; error: string | null }) {
  return (
    <div className={error ? "status error" : "status"}>
      <span>{error || status}</span>
    </div>
  );
}

function readInviteToken() {
  const url = new URL(window.location.href);
  const queryToken = url.searchParams.get("invite");
  if (queryToken) {
    return queryToken;
  }

  const match = url.pathname.match(/\/invite\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function webSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
