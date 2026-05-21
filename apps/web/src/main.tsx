import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Headphones, Mic, MicOff, Monitor, Pencil, PhoneOff, Settings, Trash2, UserRound, Users, Volume2 } from "lucide-react";
import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import rnnoiseWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import rnnoiseWorkletPath from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import "./styles.css";

type User = {
  id: string;
  nickname: string;
  status: string;
  online: boolean;
  inVoice: boolean;
  muted: boolean;
  avatarUpdatedAt?: string | null;
};

type AuthUser = {
  id: string;
  login: string;
  nickname: string;
  status: string;
  avatarUpdatedAt?: string | null;
};

type AuthResponse = {
  accessToken: string;
  user: AuthUser;
};

type RegisterResponse = {
  user: AuthUser;
};

type SettingsResponse = {
  uiSoundVolume: number;
  noiseMode: NoiseMode;
};

type VoiceVolumesResponse = {
  volumes: Record<string, number>;
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
type SignalingState = "idle" | "connecting" | "connected" | "reconnecting" | "unavailable";
type UiSound = "connect" | "reconnect" | "disconnect" | "problem" | "userJoin" | "userLeave" | "mute" | "unmute";
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

type AuthMode = "login" | "register";
type SettingsTab = "profile" | "voice" | "sound";
type AvatarDraft = {
  file: File;
  url: string;
  naturalWidth: number;
  naturalHeight: number;
  animatedPreview: boolean;
};
type Point = {
  x: number;
  y: number;
};
type AvatarCrop = {
  x: number;
  y: number;
  size: number;
};
type BrowserImageDecoder = {
  tracks: {
    ready: Promise<void>;
    selectedTrack?: {
      frameCount?: number;
    };
  };
  decode: (options?: { frameIndex?: number }) => Promise<{ image: CanvasImageSource & { duration?: number; close?: () => void } }>;
  close: () => void;
};

const inviteToken = readInviteToken();
const DEFAULT_VOICE_ROOM_NAME = "Voice Room";
const MIC_GAIN_PERCENT = 1000;
const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 12000;
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];
const UI_SOUND_VOLUME_STORAGE_KEY = "shlyapcord.uiSoundVolume";
const DEFAULT_UI_SOUND_VOLUME = 200;
const AVATAR_PREVIEW_SIZE = 280;
const AVATAR_CROP_SIZE = 220;
const AVATAR_OUTPUT_SIZE = 512;
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
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [login, setLogin] = useState("");
  const [nickname, setNickname] = useState("");
  const [profileNickname, setProfileNickname] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [name, setName] = useState("");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState<string | null>(null);
  const [inVoice, setInVoice] = useState(false);
  const [muted, setMuted] = useState(false);
  const [iceConfig, setIceConfig] = useState<IceConfig>({ iceServers: [] });
  const iceConfigRef = useRef<IceConfig>({ iceServers: [] });
  const [noiseStatus, setNoiseStatus] = useState("RNNoise");
  const [noiseMode, setNoiseMode] = useState<NoiseMode>("rnnoise");
  const [uiSoundVolume, setUiSoundVolume] = useState(() => readStoredNumber(UI_SOUND_VOLUME_STORAGE_KEY, DEFAULT_UI_SOUND_VOLUME));
  const [userVolumes, setUserVolumes] = useState<Record<string, number>>({});
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");
  const [editingProfileField, setEditingProfileField] = useState<"nickname" | "status" | null>(null);
  const [voiceDetailsOpen, setVoiceDetailsOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarDraft, setAvatarDraft] = useState<AvatarDraft | null>(null);
  const [avatarCropZoom, setAvatarCropZoom] = useState(1);
  const [avatarCropOffset, setAvatarCropOffset] = useState<Point>({ x: 0, y: 0 });
  const [avatarPreviewMode, setAvatarPreviewMode] = useState<"canvas" | "image">("canvas");
  const [inviteStatus, setInviteStatus] = useState<"checking" | "valid" | "forbidden">("checking");
  const [voiceStatus, setVoiceStatus] = useState("Not connected");
  const [signalingState, setSignalingState] = useState<SignalingState>("idle");
  const [peerStatuses, setPeerStatuses] = useState<Record<string, PeerStatus>>({});
  const [peerMetrics, setPeerMetrics] = useState<Record<string, PeerMetric>>({});
  const socketRef = useRef<WebSocket | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const accessTokenRefreshIntervalRef = useRef<number | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const heartbeatTimeoutRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const settingsSaveTimeoutRef = useRef<number | null>(null);
  const volumeSaveTimeoutsRef = useRef<Map<string, number>>(new Map());
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(false);
  const currentUserRef = useRef<User | null>(null);
  const inVoiceRef = useRef(false);
  const mutedRef = useRef(false);
  const signalingStateRef = useRef<SignalingState>("idle");
  const uiSoundVolumeRef = useRef(uiSoundVolume);
  const uiAudioContextRef = useRef<AudioContext | null>(null);
  const lastUiSoundAtRef = useRef<Record<UiSound, number>>({
    connect: 0,
    reconnect: 0,
    disconnect: 0,
    problem: 0,
    userJoin: 0,
    userLeave: 0,
    mute: 0,
    unmute: 0
  });
  const localStreamRef = useRef<MediaStream | null>(null);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rnnoiseNodeRef = useRef<RnnoiseWorkletNode | null>(null);
  const micGainNodeRef = useRef<GainNode | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerRepairTimersRef = useRef<Map<string, number>>(new Map());
  const remoteAudioRefs = useRef<Map<string, RemoteAudio>>(new Map());
  const settingsLoadedRef = useRef(false);
  const avatarDragRef = useRef<Point | null>(null);
  const avatarDraftRef = useRef<AvatarDraft | null>(null);
  const avatarCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const voiceUsers = useMemo(() => users.filter((user) => user.inVoice), [users]);
  const onlineUsers = useMemo(() => users.filter((user) => user.online), [users]);
  const offlineUsers = useMemo(() => users.filter((user) => !user.online), [users]);
  const selectedUser = useMemo(
      () => users.find((user) => user.id === selectedUserId) ?? null,
      [selectedUserId, users]
  );
  const voiceStageClassName = useMemo(() => {
    if (voiceUsers.length <= 1) {
      return "voice-stage voice-stage-one";
    }
    if (voiceUsers.length <= 4) {
      return "voice-stage voice-stage-two";
    }
    return "voice-stage voice-stage-three";
  }, [voiceUsers.length]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    inVoiceRef.current = inVoice;
  }, [inVoice]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    uiSoundVolumeRef.current = uiSoundVolume;
    window.localStorage.setItem(UI_SOUND_VOLUME_STORAGE_KEY, String(uiSoundVolume));
    if (settingsLoadedRef.current) {
      scheduleSettingsSave();
    }
  }, [uiSoundVolume]);

  useEffect(() => {
    if (settingsLoadedRef.current) {
      scheduleSettingsSave();
    }
  }, [noiseMode]);

  useEffect(() => {
    signalingStateRef.current = signalingState;
  }, [signalingState]);

  useEffect(() => {
    iceConfigRef.current = iceConfig;
  }, [iceConfig]);

  useEffect(() => {
    voiceLog("Loading ICE config from /api/ice");

    fetch("/api/ice")
        .then(async (response) => {
          voiceLog("/api/ice response", {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText
          });

          if (!response.ok) {
            throw new Error(`/api/ice failed with ${response.status}`);
          }

          return response.json();
        })
        .then((config: IceConfig) => {
          voiceLog("/api/ice parsed config", config);

          if (!config.iceServers || config.iceServers.length === 0) {
            voiceWarn("/api/ice returned empty iceServers, using fallback STUN");

            const fallbackIceConfig = {
              iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
            };

            iceConfigRef.current = fallbackIceConfig;
            setIceConfig(fallbackIceConfig);

            return;
          }

          iceConfigRef.current = config;
          setIceConfig(config);
        })
        .catch((exception) => {
          voiceError("/api/ice failed, using fallback STUN", exception);

          const fallbackIceConfig = {
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
          };

          iceConfigRef.current = fallbackIceConfig;
          setIceConfig(fallbackIceConfig);
        });

    void restoreSessionOrCheckInvite();

    return () => {
      shouldReconnectRef.current = false;
      clearHeartbeat();
      clearReconnectTimer();
      stopAccessTokenRefresh();
      clearSettingsTimers();
      leaveVoice();
      uiAudioContextRef.current?.close();
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    avatarDraftRef.current = avatarDraft;
  }, [avatarDraft]);

  useEffect(() => {
    return () => {
      if (avatarDraftRef.current) {
        URL.revokeObjectURL(avatarDraftRef.current.url);
      }
    };
  }, []);

  useEffect(() => {
    if (!avatarDraft) {
      return;
    }
    let cancelled = false;
    let frameId = 0;
    let timeoutId = 0;
    let decoder: BrowserImageDecoder | null = null;
    const image = new Image();

    const startFallbackPreview = () => {
      image.onload = () => {
        if (cancelled) {
          return;
        }
        updateAvatarNaturalSize(image.naturalWidth, image.naturalHeight);
        setAvatarPreviewMode("image");
        const render = () => {
          if (cancelled) {
            return;
          }
          drawAvatarPreview(image, avatarCanvasRef.current, image.naturalWidth, image.naturalHeight, avatarCropZoom, avatarCropOffset);
          frameId = window.requestAnimationFrame(render);
        };
        render();
      };
      image.onerror = () => {
        if (!cancelled) {
          setError("Failed to read avatar image");
        }
      };
      image.src = avatarDraft.url;
    };

    const startDecodedPreview = async () => {
      const Decoder = (window as typeof window & { ImageDecoder?: new (init: { data: Blob; type: string }) => BrowserImageDecoder }).ImageDecoder;
      if (!Decoder || !avatarDraft.file.type) {
        startFallbackPreview();
        return;
      }
      try {
        decoder = new Decoder({ data: avatarDraft.file, type: avatarDraft.file.type });
        await decoder.tracks.ready;
        if (cancelled) {
          decoder.close();
          return;
        }
        const firstFrame = await decoder.decode({ frameIndex: 0 });
        const firstImage = firstFrame.image;
        const frameWidth = Number("displayWidth" in firstImage ? (firstImage as { displayWidth: number }).displayWidth : 0);
        const frameHeight = Number("displayHeight" in firstImage ? (firstImage as { displayHeight: number }).displayHeight : 0);
        firstImage.close?.();
        if (!frameWidth || !frameHeight) {
          decoder.close();
          decoder = null;
          startFallbackPreview();
          return;
        }
        updateAvatarNaturalSize(frameWidth, frameHeight);
        const frameCount = Math.max(1, decoder.tracks.selectedTrack?.frameCount ?? 1);
        setAvatarPreviewMode(frameCount > 1 ? "canvas" : avatarDraft.animatedPreview ? "image" : "canvas");
        if (avatarDraft.animatedPreview && frameCount <= 1) {
          decoder.close();
          decoder = null;
          startFallbackPreview();
          return;
        }
        let frameIndex = 0;
        const renderFrame = async () => {
          if (cancelled || !decoder) {
            return;
          }
          try {
            const result = await decoder.decode({ frameIndex });
            if (cancelled) {
              result.image.close?.();
              return;
            }
            drawAvatarPreview(result.image, avatarCanvasRef.current, frameWidth, frameHeight, avatarCropZoom, avatarCropOffset);
            const durationMs = Math.max(20, Math.round((result.image.duration ?? 100000) / 1000));
            result.image.close?.();
            frameIndex = frameCount > 1 ? (frameIndex + 1) % frameCount : 0;
            timeoutId = window.setTimeout(renderFrame, durationMs);
          } catch {
            if (!cancelled) {
              decoder?.close();
              decoder = null;
              startFallbackPreview();
            }
          }
        };
        void renderFrame();
      } catch {
        if (!cancelled) {
          decoder?.close();
          decoder = null;
          startFallbackPreview();
        }
      }
    };

    void startDecodedPreview();

    return () => {
      cancelled = true;
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      decoder?.close();
    };
  }, [avatarDraft, avatarCropZoom, avatarCropOffset]);

  useEffect(() => {
    if (!inVoice) {
      return;
    }

    syncVoiceStatus();
    const interval = window.setInterval(() => {
      void refreshPeerMetrics();
      syncVoiceStatus();
    }, 2000);
    void refreshPeerMetrics();

    return () => window.clearInterval(interval);
  }, [inVoice, peerStatuses]);


  function safeJson(data: unknown) {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }

  function voiceLog(label: string, data?: unknown) {
    const time = new Date().toISOString();
    if (data === undefined) {
      console.log(`[VOICE ${time}] ${label}`);
      return;
    }
    console.log(`[VOICE ${time}] ${label}
${safeJson(data)}`);
  }

  function voiceWarn(label: string, data?: unknown) {
    const time = new Date().toISOString();
    if (data === undefined) {
      console.warn(`[VOICE ${time}] ${label}`);
      return;
    }
    console.warn(`[VOICE ${time}] ${label}
${safeJson(data)}`);
  }

  function voiceError(label: string, data?: unknown) {
    const time = new Date().toISOString();
    if (data === undefined) {
      console.error(`[VOICE ${time}] ${label}`);
      return;
    }
    console.error(`[VOICE ${time}] ${label}
${safeJson(data)}`);
  }

  function summarizeIceCandidate(candidate: RTCIceCandidateInit | RTCIceCandidate | null) {
    if (!candidate) {
      return null;
    }

    const raw = ((candidate as RTCIceCandidateInit).candidate ?? "").toString();
    const parts = raw.split(" ");

    return {
      candidate: raw,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
      foundation: parts[0],
      protocol: parts[2],
      address: parts[4],
      port: parts[5],
      type: parts[7],
      hasRelay: raw.includes(" typ relay"),
      hasSrflx: raw.includes(" typ srflx"),
      hasHost: raw.includes(" typ host")
    };
  }

  function summarizeDescription(description: RTCSessionDescriptionInit | RTCSessionDescription | null) {
    if (!description) {
      return null;
    }

    const sdp = description.sdp ?? "";

    return {
      type: description.type,
      hasAudio: sdp.includes("m=audio"),
      candidatesInSdp: (sdp.match(/a=candidate:/g) ?? []).length,
      hasRelayCandidate: sdp.includes(" typ relay"),
      hasSrflxCandidate: sdp.includes(" typ srflx"),
      hasHostCandidate: sdp.includes(" typ host"),
      iceUfrag: sdp.match(/a=ice-ufrag:(.+)/)?.[1] ?? null
    };
  }

  async function restoreSessionOrCheckInvite() {
    try {
      const response = await apiJson<AuthResponse>("/api/auth/refresh", { method: "POST" });
      accessTokenRef.current = response.accessToken;
      setAuthUser(response.user);
      setProfileNickname(response.user.nickname);
      setProfileStatus(response.user.status);
      setName(response.user.nickname);
      setInviteStatus("valid");
      await loadUserSettings();
      startAccessTokenRefresh();
      shouldReconnectRef.current = true;
      reconnectAttemptRef.current = 0;
      void connectSocket(false, response.user.nickname);
      return;
    } catch {
      accessTokenRef.current = null;
    }

    if (!inviteToken) {
      setInviteStatus("forbidden");
      return;
    }

    fetch(`/api/invites/${encodeURIComponent(inviteToken)}`)
        .then((response) => setInviteStatus(response.ok ? "valid" : "forbidden"))
        .catch(() => setInviteStatus("forbidden"));
  }

  async function handleAuthSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!inviteToken) {
      setError("Invite token is missing");
      return;
    }
    if (!login.trim()) {
      setError("Enter login");
      return;
    }

    try {
      setStatus(authMode === "register" ? "Creating account" : "Signing in");
      if (authMode === "register") {
        await apiJson<RegisterResponse>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ inviteToken, login, nickname, password, passwordRepeat })
        });
        setAuthMode("login");
        setPassword("");
        setPasswordRepeat("");
        setStatus("Account created. Sign in.");
        return;
      }

      const response = await apiJson<AuthResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ inviteToken, login, password })
      });
      accessTokenRef.current = response.accessToken;
      setAuthUser(response.user);
      setName(response.user.nickname);
      setProfileNickname(response.user.nickname);
      setProfileStatus(response.user.status);
      await loadUserSettings();
      startAccessTokenRefresh();
      shouldReconnectRef.current = true;
      reconnectAttemptRef.current = 0;
      unlockUiAudio();
      void connectSocket(false, response.user.nickname);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Auth failed");
      setStatus("Auth failed");
    }
  }

  async function connectSocket(isReconnect: boolean, authName?: string) {
    const existingSocket = socketRef.current;
    if (
        existingSocket &&
        (existingSocket.readyState === WebSocket.CONNECTING || existingSocket.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    clearHeartbeat();
    clearReconnectTimer();
    if (!isReconnect) {
      setError(null);
    }
    setSignalingState(isReconnect ? "reconnecting" : "connecting");
    setStatus(isReconnect ? "Reconnecting" : "Connecting");

    if (isReconnect) {
      const refreshed = await refreshAccessTokenForReconnect();
      if (!refreshed) {
        if (shouldReconnectRef.current) {
          scheduleReconnect();
        }
        return;
      }
    }

    const socket = new WebSocket(webSocketUrl());
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setSignalingState("connected");
      setError(null);
      setStatus("Online");
      reconnectAttemptRef.current = 0;
      startHeartbeat();
      send("auth.token", { accessToken: accessTokenRef.current });
    });

    socket.addEventListener("message", async (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      await handleServerMessage(message);
    });

    socket.addEventListener("close", () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      clearHeartbeat();
      closePeers();

      if (shouldReconnectRef.current && currentUserRef.current) {
        setSignalingState("reconnecting");
        setStatus("Online");
        playUiSound("reconnect");
        if (inVoiceRef.current) {
          setVoiceStatus("Server disconnected");
        }
        scheduleReconnect();
        return;
      }

      setSignalingState("unavailable");
      setStatus("Online");
      setInVoice(false);
      playUiSound("disconnect");
    });

    socket.addEventListener("error", () => {
      setSignalingState(shouldReconnectRef.current ? "reconnecting" : "unavailable");
      setError("Connection error");
      setStatus("Online");
    });
  }

  function startAccessTokenRefresh() {
    stopAccessTokenRefresh();
    accessTokenRefreshIntervalRef.current = window.setInterval(() => {
      void refreshAccessToken();
    }, 12 * 60 * 1000);
  }

  function stopAccessTokenRefresh() {
    if (accessTokenRefreshIntervalRef.current != null) {
      window.clearInterval(accessTokenRefreshIntervalRef.current);
      accessTokenRefreshIntervalRef.current = null;
    }
  }

  async function refreshAccessToken() {
    try {
      const response = await apiJson<AuthResponse>("/api/auth/refresh", { method: "POST" });
      accessTokenRef.current = response.accessToken;
      setAuthUser(response.user);
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        send("auth.refresh", { accessToken: response.accessToken });
      }
    } catch {
      accessTokenRef.current = null;
      stopAccessTokenRefresh();
      shouldReconnectRef.current = false;
      socketRef.current?.close();
      setCurrentUser(null);
      setAuthUser(null);
      setError("Session expired");
    }
  }

  function authedApiJson<T>(url: string, init: RequestInit = {}) {
    return apiJson<T>(url, {
      ...init,
      headers: {
        ...authHeaders(accessTokenRef.current),
        ...(init.headers ?? {})
      }
    });
  }

  function authedApiForm<T>(url: string, init: RequestInit = {}) {
    return apiForm<T>(url, {
      ...init,
      headers: {
        ...authHeaders(accessTokenRef.current),
        ...(init.headers ?? {})
      }
    });
  }

  async function loadUserSettings() {
    try {
      const [settings, voiceVolumes] = await Promise.all([
        authedApiJson<SettingsResponse>("/api/settings"),
        authedApiJson<VoiceVolumesResponse>("/api/settings/voice-volumes")
      ]);
      settingsLoadedRef.current = false;
      setUiSoundVolume(settings.uiSoundVolume);
      setNoiseMode(settings.noiseMode);
      setUserVolumes(voiceVolumes.volumes ?? {});
      window.setTimeout(() => {
        settingsLoadedRef.current = true;
      }, 0);
    } catch {
      settingsLoadedRef.current = true;
    }
  }

  function scheduleSettingsSave() {
    if (!accessTokenRef.current) {
      return;
    }
    if (settingsSaveTimeoutRef.current != null) {
      window.clearTimeout(settingsSaveTimeoutRef.current);
    }
    settingsSaveTimeoutRef.current = window.setTimeout(() => {
      settingsSaveTimeoutRef.current = null;
      void authedApiJson<SettingsResponse>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ uiSoundVolume, noiseMode })
      }).catch(() => setError("Failed to save settings"));
    }, 400);
  }

  function scheduleVoiceVolumeSave(userId: string, volume: number) {
    if (!accessTokenRef.current) {
      return;
    }
    const existing = volumeSaveTimeoutsRef.current.get(userId);
    if (existing != null) {
      window.clearTimeout(existing);
    }
    const timer = window.setTimeout(() => {
      volumeSaveTimeoutsRef.current.delete(userId);
      void authedApiJson<VoiceVolumesResponse>(`/api/settings/voice-volumes/${encodeURIComponent(userId)}`, {
        method: "PUT",
        body: JSON.stringify({ volumePercent: volume })
      }).catch(() => setError("Failed to save volume"));
    }, 400);
    volumeSaveTimeoutsRef.current.set(userId, timer);
  }

  function clearSettingsTimers() {
    if (settingsSaveTimeoutRef.current != null) {
      window.clearTimeout(settingsSaveTimeoutRef.current);
      settingsSaveTimeoutRef.current = null;
    }
    for (const timer of volumeSaveTimeoutsRef.current.values()) {
      window.clearTimeout(timer);
    }
    volumeSaveTimeoutsRef.current.clear();
  }

  async function saveProfile() {
    if (!accessTokenRef.current) {
      return;
    }
    setProfileSaving(true);
    setError(null);
    try {
      const user = await authedApiJson<AuthUser>("/api/me/profile", {
        method: "PATCH",
        body: JSON.stringify({ nickname: profileNickname, status: profileStatus })
      });
      applyOwnProfile(user);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Failed to save profile");
    } finally {
      setProfileSaving(false);
    }
  }

  async function refreshAccessTokenForReconnect() {
    try {
      const response = await fetch("/api/auth/refresh", {
        credentials: "same-origin",
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      });

      if (response.status === 401 || response.status === 403) {
        accessTokenRef.current = null;
        stopAccessTokenRefresh();
        shouldReconnectRef.current = false;
        setCurrentUser(null);
        setAuthUser(null);
        setError("Session expired");
        return false;
      }

      if (!response.ok) {
        return false;
      }

      const payload = await response.json() as AuthResponse;
      accessTokenRef.current = payload.accessToken;
      setAuthUser(payload.user);
      return true;
    } catch {
      return false;
    }
  }

  function startProfileEdit(field: "nickname" | "status") {
    setEditingProfileField(field);
    setProfileNickname(authUser?.nickname ?? currentUser?.nickname ?? "");
    setProfileStatus(authUser?.status ?? currentUser?.status ?? "");
  }

  function cancelProfileEdit() {
    setProfileNickname(authUser?.nickname ?? currentUser?.nickname ?? "");
    setProfileStatus(authUser?.status ?? currentUser?.status ?? "");
    setEditingProfileField(null);
  }

  async function saveProfileOnEnter(event: React.KeyboardEvent<HTMLInputElement>, field: "nickname" | "status") {
    if (event.key === "Enter") {
      event.preventDefault();
      await saveProfile();
      setEditingProfileField(null);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelProfileEdit();
      return;
    }
    if (editingProfileField !== field) {
      event.preventDefault();
    }
  }

  async function uploadAvatar(file: File | null, crop?: AvatarCrop) {
    if (!file || !accessTokenRef.current) {
      return;
    }
    setAvatarSaving(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (crop) {
        formData.append("cropX", String(crop.x));
        formData.append("cropY", String(crop.y));
        formData.append("cropSize", String(crop.size));
      }
      const user = await authedApiForm<AuthUser>("/api/me/avatar", {
        method: "PUT",
        body: formData
      });
      applyOwnProfile(user);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Failed to upload avatar");
    } finally {
      setAvatarSaving(false);
    }
  }

  function openAvatarCrop(file: File | null) {
    if (!file) {
      return;
    }
    setError(null);
    setAvatarCropZoom(1);
    setAvatarCropOffset({ x: 0, y: 0 });
    const nextDraft = {
      file,
      url: URL.createObjectURL(file),
      naturalWidth: 0,
      naturalHeight: 0,
      animatedPreview: file.type === "image/gif" || file.type === "image/webp"
    };
    setAvatarDraft((currentDraft) => {
      if (currentDraft) {
        URL.revokeObjectURL(currentDraft.url);
      }
      return nextDraft;
    });
  }

  function closeAvatarCrop() {
    setAvatarDraft((currentDraft) => {
      if (currentDraft) {
        URL.revokeObjectURL(currentDraft.url);
      }
      return null;
    });
    avatarDragRef.current = null;
  }

  function updateAvatarNaturalSize(width: number, height: number) {
    setAvatarDraft((currentDraft) => currentDraft ? {
      ...currentDraft,
      naturalWidth: width,
      naturalHeight: height
    } : currentDraft);
  }

  function setClampedAvatarZoom(nextZoom: number) {
    const zoom = Math.min(3, Math.max(1, nextZoom));
    setAvatarCropZoom(zoom);
    setAvatarCropOffset((offset) => clampAvatarOffset(offset, zoom, avatarDraft));
  }

  function moveAvatarCrop(deltaX: number, deltaY: number) {
    setAvatarCropOffset((offset) => clampAvatarOffset({
      x: offset.x + deltaX,
      y: offset.y + deltaY
    }, avatarCropZoom, avatarDraft));
  }

  async function confirmAvatarCrop() {
    if (!avatarDraft || avatarDraft.naturalWidth <= 0 || avatarDraft.naturalHeight <= 0) {
      return;
    }
    setAvatarSaving(true);
    setError(null);
    try {
      const crop = avatarSourceCrop(avatarDraft, avatarCropZoom, avatarCropOffset);
      closeAvatarCrop();
      if (avatarDraft.animatedPreview) {
        await uploadAvatar(avatarDraft.file, crop);
      } else {
        const croppedFile = await createCroppedAvatarFile(avatarDraft, crop);
        await uploadAvatar(croppedFile);
      }
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Failed to crop avatar");
      setAvatarSaving(false);
    }
  }

  async function deleteAvatar() {
    if (!accessTokenRef.current) {
      return;
    }
    setAvatarSaving(true);
    setError(null);
    try {
      const user = await authedApiJson<AuthUser>("/api/me/avatar", { method: "DELETE" });
      applyOwnProfile(user);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Failed to delete avatar");
    } finally {
      setAvatarSaving(false);
    }
  }

  function applyOwnProfile(user: AuthUser) {
    setAuthUser(user);
    setProfileNickname(user.nickname);
    setProfileStatus(user.status);
    setCurrentUser((current) => current ? {
      ...current,
      nickname: user.nickname,
      status: user.status,
      avatarUpdatedAt: user.avatarUpdatedAt
    } : current);
    currentUserRef.current = currentUserRef.current ? {
      ...currentUserRef.current,
      nickname: user.nickname,
      status: user.status,
      avatarUpdatedAt: user.avatarUpdatedAt
    } : currentUserRef.current;
    setUsers((previous) =>
        previous.map((item) => item.id === user.id ? {
          ...item,
          nickname: user.nickname,
          status: user.status,
          avatarUpdatedAt: user.avatarUpdatedAt
        } : item)
    );
  }

  async function handleLogout() {
    shouldReconnectRef.current = false;
    stopAccessTokenRefresh();
    clearSettingsTimers();
    try {
      await apiJson<void>("/api/auth/logout", { method: "POST" });
    } catch {
      // Local logout still needs to clear client state if the server is unreachable.
    }
    leaveVoice();
    socketRef.current?.close();
    accessTokenRef.current = null;
    setAuthUser(null);
    setCurrentUser(null);
    currentUserRef.current = null;
    setUsers([]);
    setInVoice(false);
    setMuted(false);
    setSettingsOpen(false);
    setVoiceDetailsOpen(false);
    setLogoutConfirmOpen(false);
    setSelectedUserId(null);
    setStatus("Signed out");
  }

  async function handleServerMessage(message: ServerMessage) {
    voiceLog("WS message received", {
      type: message.type,
      payload:
          message.type === "webrtc.offer" || message.type === "webrtc.answer"
              ? {
                sourceUserId: message.payload.sourceUserId,
                payload: summarizeDescription(message.payload.payload)
              }
              : message.type === "webrtc.iceCandidate"
                  ? {
                    sourceUserId: message.payload.sourceUserId,
                    payload: summarizeIceCandidate(message.payload.payload)
                  }
                  : message.payload
    });

    switch (message.type) {
      case "system.pong":
        clearHeartbeatTimeout();
        break;
      case "auth.ok":
        setError(null);
        setCurrentUser(message.payload.user);
        currentUserRef.current = message.payload.user;
        setSignalingState("connected");
        setStatus("Online");
        if (inVoiceRef.current) {
          setVoiceStatus("Rejoining voice");
          send("voice.join", {});
          applyLocalMuteState(mutedRef.current);
          if (mutedRef.current) {
            send("voice.mute", { muted: true });
          }
        }
        break;
      case "auth.error":
      case "error":
        if (message.type === "auth.error") {
          shouldReconnectRef.current = false;
        }
        setError(message.payload.message);
        break;
      case "users.list":
        setUsers(message.payload.users);
        break;
      case "user.updated":
        setUsers((previous) =>
            previous.map((user) =>
                user.id === message.payload.user.id ? { ...user, ...message.payload.user } : user
            )
        );
        if (message.payload.user.id === currentUserRef.current?.id) {
          const updatedName = message.payload.user.nickname;
          setCurrentUser((user) => (user ? { ...user, ...message.payload.user, nickname: updatedName } : user));
          currentUserRef.current = currentUserRef.current
              ? { ...currentUserRef.current, ...message.payload.user, nickname: updatedName }
              : currentUserRef.current;
          setAuthUser((user) => (user ? {
            ...user,
            nickname: updatedName,
            status: message.payload.user.status,
            avatarUpdatedAt: message.payload.user.avatarUpdatedAt
          } : user));
          setProfileNickname(updatedName);
          setProfileStatus(message.payload.user.status ?? "");
        }
        break;
      case "voice.users":
        await ensurePeerOffersFor(message.payload.users);
        break;
      case "voice.userJoined":
        if (message.payload.user?.id !== currentUserRef.current?.id) {
          playUiSound("userJoin");
        }
        await ensurePeerOfferFor(message.payload.user);
        break;
      case "voice.userLeft":
      case "user.left":
        if (message.payload.userId !== currentUserRef.current?.id) {
          playUiSound("userLeave");
        }
        closePeer(message.payload.userId);
        break;
      case "voice.userMuted":
        setUsers((previous) =>
            previous.map((user) =>
                user.id === message.payload.userId ? { ...user, muted: Boolean(message.payload.muted) } : user
            )
        );
        if (message.payload.userId === currentUserRef.current?.id) {
          setCurrentUser((user) => (user ? { ...user, muted: Boolean(message.payload.muted) } : user));
        }
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
    voiceLog("joinVoice clicked", {
      currentUserId: currentUserRef.current?.id,
      signalingState: signalingStateRef.current,
      socketReadyState: socketRef.current?.readyState,
      iceConfigState: iceConfig,
      iceConfigRef: iceConfigRef.current,
      existingLocalStream: Boolean(localStreamRef.current)
    });

    setError(null);

    try {
      setVoiceStatus("Requesting microphone");

      voiceLog("Requesting microphone", AUDIO_CONSTRAINTS);
      const stream = await createLocalAudioStream();

      voiceLog("Microphone stream created", {
        streamId: stream.id,
        tracks: stream.getTracks().map((track) => ({
          id: track.id,
          kind: track.kind,
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          settings: track.getSettings()
        }))
      });

      localStreamRef.current = stream;
      setVoiceStatus("Joining voice");
      setInVoice(true);

      voiceLog("Sending voice.join");
      send("voice.join", {});

      playUiSound("connect");
    } catch (exception) {
      voiceError("joinVoice failed", exception);
      setVoiceStatus("Microphone denied");
      setError("Connection error");
    }
  }

  function leaveVoice() {
    if (inVoiceRef.current) {
      playUiSound("disconnect");
    }
    send("voice.leave", {});
    setInVoice(false);
    setMuted(false);
    mutedRef.current = false;
    setVoiceStatus("Not connected");
    setPeerStatuses({});
    setPeerMetrics({});
    stopLocalAudio();
    closePeers();
  }

  function toggleMute() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    mutedRef.current = nextMuted;
    applyLocalMuteState(nextMuted);
    send("voice.mute", { muted: nextMuted });
    playUiSound(nextMuted ? "mute" : "unmute");
  }

  function applyLocalMuteState(nextMuted: boolean) {
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
  }

  async function ensurePeerOffersFor(remoteUsers: User[]) {
    for (const remoteUser of remoteUsers) {
      await ensurePeerOfferFor(remoteUser);
    }
  }

  async function ensurePeerOfferFor(remoteUser: User) {
    if (!currentUserRef.current || remoteUser.id === currentUserRef.current.id || !remoteUser.inVoice) {
      return;
    }

    if (!shouldInitiateOffer(remoteUser.id)) {
      return;
    }

    await createOfferFor(remoteUser.id);
  }

  async function createOfferFor(remoteUserId: string) {
    voiceLog("createOfferFor called", {
      remoteUserId,
      localStreamExists: Boolean(localStreamRef.current)
    });

    if (!localStreamRef.current) {
      voiceWarn("createOfferFor skipped: no local stream", { remoteUserId });
      return;
    }

    const peer = createPeer(remoteUserId);

    if (peer.signalingState !== "stable") {
      voiceWarn("createOfferFor skipped: peer signaling state is not stable", {
        remoteUserId,
        signalingState: peer.signalingState
      });
      return;
    }

    const offer = await peer.createOffer();
    voiceLog("Offer created", {
      remoteUserId,
      offer: summarizeDescription(offer)
    });

    await peer.setLocalDescription(offer);
    voiceLog("Local description set for offer", {
      remoteUserId,
      localDescription: summarizeDescription(peer.localDescription)
    });

    send("webrtc.offer", offer, remoteUserId);
  }

  function shouldInitiateOffer(remoteUserId: string) {
    const currentUserId = currentUserRef.current?.id;
    return Boolean(currentUserId && currentUserId < remoteUserId);
  }

  async function handleOffer(sourceUserId: string, offer: RTCSessionDescriptionInit) {
    voiceLog("handleOffer called", {
      sourceUserId,
      offer: summarizeDescription(offer),
      localStreamExists: Boolean(localStreamRef.current)
    });

    if (!localStreamRef.current) {
      voiceWarn("handleOffer: no local stream, creating one", { sourceUserId });
      const stream = await createLocalAudioStream();
      localStreamRef.current = stream;
      setInVoice(true);
    }

    let peer = createPeer(sourceUserId);

    if (peer.signalingState !== "stable") {
      voiceWarn("handleOffer: peer is not stable", {
        sourceUserId,
        signalingState: peer.signalingState,
        shouldInitiateOffer: shouldInitiateOffer(sourceUserId)
      });

      if (shouldInitiateOffer(sourceUserId)) {
        voiceWarn("handleOffer skipped because this client should initiate offer", { sourceUserId });
        return;
      }

      closePeer(sourceUserId);
      peer = createPeer(sourceUserId);
    }

    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    voiceLog("Remote description set from offer", {
      sourceUserId,
      remoteDescription: summarizeDescription(peer.remoteDescription)
    });

    const answer = await peer.createAnswer();
    voiceLog("Answer created", {
      sourceUserId,
      answer: summarizeDescription(answer)
    });

    await peer.setLocalDescription(answer);
    voiceLog("Local description set for answer", {
      sourceUserId,
      localDescription: summarizeDescription(peer.localDescription)
    });

    send("webrtc.answer", answer, sourceUserId);
  }

  async function handleAnswer(sourceUserId: string, answer: RTCSessionDescriptionInit) {
    voiceLog("handleAnswer called", {
      sourceUserId,
      answer: summarizeDescription(answer)
    });

    const peer = peersRef.current.get(sourceUserId);

    if (!peer) {
      voiceWarn("handleAnswer skipped: peer not found", { sourceUserId });
      return;
    }

    voiceLog("Setting remote answer", {
      sourceUserId,
      signalingState: peer.signalingState,
      connectionState: peer.connectionState,
      iceConnectionState: peer.iceConnectionState
    });

    await peer.setRemoteDescription(new RTCSessionDescription(answer));

    voiceLog("Remote description set from answer", {
      sourceUserId,
      remoteDescription: summarizeDescription(peer.remoteDescription)
    });
  }

  async function handleIceCandidate(sourceUserId: string, candidate: RTCIceCandidateInit) {
    voiceLog("handleIceCandidate called", {
      sourceUserId,
      candidate: summarizeIceCandidate(candidate)
    });

    const peer = peersRef.current.get(sourceUserId);

    if (!peer) {
      voiceWarn("handleIceCandidate skipped: peer not found", {
        sourceUserId,
        candidate: summarizeIceCandidate(candidate)
      });
      return;
    }

    if (!candidate) {
      voiceWarn("handleIceCandidate skipped: empty candidate", { sourceUserId });
      return;
    }

    try {
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
      voiceLog("ICE candidate added", {
        sourceUserId,
        candidate: summarizeIceCandidate(candidate)
      });
    } catch (exception) {
      voiceError("Failed to add ICE candidate", {
        sourceUserId,
        candidate: summarizeIceCandidate(candidate),
        exception
      });
    }
  }

  function createPeer(remoteUserId: string) {
    const existing = peersRef.current.get(remoteUserId);
    if (existing) {
      voiceLog("createPeer reused existing peer", {
        remoteUserId,
        connectionState: existing.connectionState,
        iceConnectionState: existing.iceConnectionState,
        signalingState: existing.signalingState,
        iceGatheringState: existing.iceGatheringState
      });

      return existing;
    }

    const activeIceConfig = iceConfigRef.current;

    voiceLog("Creating RTCPeerConnection", {
      remoteUserId,
      currentUserId: currentUserRef.current?.id,
      shouldInitiateOffer: shouldInitiateOffer(remoteUserId),
      iceConfigState: iceConfig,
      iceConfigRef: activeIceConfig,
      localStreamExists: Boolean(localStreamRef.current),
      localTracks: localStreamRef.current?.getTracks().map((track) => ({
        id: track.id,
        kind: track.kind,
        label: track.label,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
        settings: track.getSettings()
      }))
    });

    const peer = new RTCPeerConnection(activeIceConfig);
    updatePeerStatus(remoteUserId, peer);

    localStreamRef.current?.getTracks().forEach((track) => {
      voiceLog("Adding local track to peer", {
        remoteUserId,
        trackId: track.id,
        kind: track.kind,
        label: track.label,
        enabled: track.enabled,
        readyState: track.readyState
      });

      peer.addTrack(track, localStreamRef.current!);
    });

    peer.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        voiceLog("ICE candidate gathered", {
          remoteUserId,
          candidate: summarizeIceCandidate(event.candidate)
        });

        send("webrtc.iceCandidate", event.candidate.toJSON(), remoteUserId);
        return;
      }

      voiceLog("ICE gathering complete / null candidate", {
        remoteUserId,
        iceGatheringState: peer.iceGatheringState
      });
    });

    peer.addEventListener("icecandidateerror", (event) => {
      voiceError("ICE candidate error", {
        remoteUserId,
        address: event.address,
        port: event.port,
        url: event.url,
        errorCode: event.errorCode,
        errorText: event.errorText
      });
    });

    peer.addEventListener("icegatheringstatechange", () => {
      voiceLog("ICE gathering state changed", {
        remoteUserId,
        iceGatheringState: peer.iceGatheringState
      });
    });

    peer.addEventListener("iceconnectionstatechange", () => {
      voiceLog("ICE connection state changed", {
        remoteUserId,
        iceConnectionState: peer.iceConnectionState,
        connectionState: peer.connectionState,
        signalingState: peer.signalingState
      });

      updatePeerStatus(remoteUserId, peer);

      if (peer.iceConnectionState === "connected" || peer.iceConnectionState === "completed") {
        clearPeerRepairTimer(remoteUserId);
        void logSelectedCandidatePair(remoteUserId, peer);
      } else if (["failed", "disconnected"].includes(peer.iceConnectionState)) {
        voiceWarn("ICE connection needs repair", {
          remoteUserId,
          iceConnectionState: peer.iceConnectionState
        });

        void logAllCandidatePairs(remoteUserId, peer);
        schedulePeerRepair(remoteUserId);
      }
    });

    peer.addEventListener("connectionstatechange", () => {
      voiceLog("Peer connection state changed", {
        remoteUserId,
        connectionState: peer.connectionState,
        iceConnectionState: peer.iceConnectionState,
        signalingState: peer.signalingState
      });

      updatePeerStatus(remoteUserId, peer);

      if (["failed", "closed"].includes(peer.connectionState)) {
        voiceWarn("Peer failed/closed, repairing", {
          remoteUserId,
          connectionState: peer.connectionState
        });

        void logAllCandidatePairs(remoteUserId, peer);
        closePeer(remoteUserId);
        void repairPeer(remoteUserId);
        return;
      }

      if (peer.connectionState === "connected") {
        clearPeerRepairTimer(remoteUserId);
        void logSelectedCandidatePair(remoteUserId, peer);
      } else {
        schedulePeerRepair(remoteUserId);
      }
    });

    peer.addEventListener("signalingstatechange", () => {
      voiceLog("Peer signaling state changed", {
        remoteUserId,
        signalingState: peer.signalingState
      });
    });

    peer.addEventListener("negotiationneeded", () => {
      voiceLog("Peer negotiationneeded", {
        remoteUserId,
        signalingState: peer.signalingState
      });
    });

    peer.addEventListener("track", (event) => {
      const [stream] = event.streams;

      voiceLog("Remote track received", {
        remoteUserId,
        track: {
          id: event.track.id,
          kind: event.track.kind,
          label: event.track.label,
          enabled: event.track.enabled,
          muted: event.track.muted,
          readyState: event.track.readyState
        },
        streamId: stream?.id,
        streamTracks: stream?.getTracks().map((track) => ({
          id: track.id,
          kind: track.kind,
          enabled: track.enabled,
          readyState: track.readyState
        }))
      });

      attachRemoteAudio(remoteUserId, stream);
    });

    peersRef.current.set(remoteUserId, peer);
    schedulePeerRepair(remoteUserId);

    return peer;
  }

  function closePeer(userId: string) {
    clearPeerRepairTimer(userId);
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

  function schedulePeerRepair(userId: string) {
    if (peerRepairTimersRef.current.has(userId)) {
      return;
    }
    const timer = window.setTimeout(() => {
      peerRepairTimersRef.current.delete(userId);
      void repairPeer(userId);
    }, 12000);
    peerRepairTimersRef.current.set(userId, timer);
  }

  function clearPeerRepairTimer(userId: string) {
    const timer = peerRepairTimersRef.current.get(userId);
    if (timer != null) {
      window.clearTimeout(timer);
      peerRepairTimersRef.current.delete(userId);
    }
  }

  async function repairPeer(userId: string) {
    if (!inVoiceRef.current || signalingStateRef.current !== "connected") {
      return;
    }

    const peer = peersRef.current.get(userId);
    if (peer?.connectionState === "connected") {
      return;
    }

    closePeer(userId);
    if (shouldInitiateOffer(userId)) {
      await createOfferFor(userId);
    }
  }

  function unlockUiAudio() {
    try {
      const context = uiAudioContextRef.current ?? new AudioContext();
      uiAudioContextRef.current = context;
      void context.resume();
    } catch {
      // Browsers may still block audio until a user gesture; the next click will retry.
    }
  }

  function playUiSound(sound: UiSound) {
    try {
      const now = Date.now();
      if (now - lastUiSoundAtRef.current[sound] < 700) {
        return;
      }
      lastUiSoundAtRef.current[sound] = now;

      const context = uiAudioContextRef.current ?? new AudioContext();
      uiAudioContextRef.current = context;
      void context.resume();

      const patterns: Record<UiSound, Array<[number, number, number]>> = {
        connect: [
          [420, 0, 0.08],
          [640, 0.09, 0.12]
        ],
        reconnect: [
          [360, 0, 0.07],
          [520, 0.09, 0.07],
          [360, 0.18, 0.07]
        ],
        userJoin: [
          [500, 0, 0.06],
          [720, 0.07, 0.09]
        ],
        userLeave: [
          [650, 0, 0.06],
          [420, 0.07, 0.09]
        ],
        mute: [
          [440, 0, 0.05],
          [260, 0.06, 0.08]
        ],
        unmute: [
          [260, 0, 0.05],
          [440, 0.06, 0.08]
        ],
        disconnect: [
          [520, 0, 0.08],
          [300, 0.09, 0.12]
        ],
        problem: [
          [240, 0, 0.13],
          [210, 0.16, 0.18]
        ]
      };

      const peakVolume = Math.max(0, Math.min(uiSoundVolumeRef.current, 400)) / 100;
      const peakGain = Math.max(0.0001, 0.05 * peakVolume);
      for (const [frequency, offset, duration] of patterns[sound]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const startAt = context.currentTime + offset;
        const endAt = startAt + duration;

        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(startAt);
        oscillator.stop(endAt + 0.02);
      }
    } catch {
      // UI sounds are non-critical.
    }
  }

  function startHeartbeat() {
    clearHeartbeat();
    sendHeartbeat();
    heartbeatIntervalRef.current = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  }

  function sendHeartbeat() {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    clearHeartbeatTimeout();
    socket.send(JSON.stringify({ type: "system.ping", payload: { timestamp: Date.now() } }));
    heartbeatTimeoutRef.current = window.setTimeout(() => {
      setSignalingState("unavailable");
      setStatus("Online");
      if (inVoiceRef.current) {
        setVoiceStatus("Server unavailable");
      }
      playUiSound("problem");
      socket.close();
    }, HEARTBEAT_TIMEOUT_MS);
  }

  function clearHeartbeat() {
    if (heartbeatIntervalRef.current != null) {
      window.clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    clearHeartbeatTimeout();
  }

  function clearHeartbeatTimeout() {
    if (heartbeatTimeoutRef.current != null) {
      window.clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
  }

  function scheduleReconnect() {
    clearReconnectTimer();
    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS_MS.length - 1)];
    reconnectAttemptRef.current += 1;
    reconnectTimeoutRef.current = window.setTimeout(() => void connectSocket(true), delay);
  }

  function clearReconnectTimer() {
    if (reconnectTimeoutRef.current != null) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }

  function send(type: string, payload: unknown, targetUserId?: string) {
    const socket = socketRef.current;

    voiceLog("WS send requested", {
      type,
      targetUserId,
      socketReadyState: socket?.readyState,
      payload:
          type === "webrtc.offer" || type === "webrtc.answer"
              ? summarizeDescription(payload as RTCSessionDescriptionInit)
              : type === "webrtc.iceCandidate"
                  ? summarizeIceCandidate(payload as RTCIceCandidateInit)
                  : payload
    });

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      voiceWarn("WS send skipped: socket is not open", {
        type,
        targetUserId,
        socketReadyState: socket?.readyState
      });
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
    scheduleVoiceVolumeSave(userId, volume);
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
    return `${voiceStatus} - ${connectedPeerCount()}/${totalPeerCount()} peers - ${noiseStatus}`;
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

  async function logSelectedCandidatePair(userId: string, peer: RTCPeerConnection) {
    try {
      const report = await peer.getStats();
      let selectedPair: any;
      let selectedPairId: string | undefined;

      report.forEach((stat: any) => {
        if (stat.type === "transport" && stat.selectedCandidatePairId) {
          selectedPairId = stat.selectedCandidatePairId;
        }

        if (stat.type === "candidate-pair" && (stat.selected || stat.nominated) && stat.state === "succeeded") {
          selectedPair = stat;
        }
      });

      if (!selectedPair && selectedPairId) {
        selectedPair = report.get(selectedPairId);
      }

      const localCandidate = selectedPair?.localCandidateId ? report.get(selectedPair.localCandidateId) as any : undefined;
      const remoteCandidate = selectedPair?.remoteCandidateId ? report.get(selectedPair.remoteCandidateId) as any : undefined;

      voiceLog("Selected ICE candidate pair", {
        userId,
        pair: selectedPair
            ? {
              id: selectedPair.id,
              state: selectedPair.state,
              nominated: selectedPair.nominated,
              currentRoundTripTime: selectedPair.currentRoundTripTime,
              availableOutgoingBitrate: selectedPair.availableOutgoingBitrate,
              bytesSent: selectedPair.bytesSent,
              bytesReceived: selectedPair.bytesReceived,
              requestsSent: selectedPair.requestsSent,
              responsesReceived: selectedPair.responsesReceived
            }
            : null,
        localCandidate: localCandidate
            ? {
              candidateType: localCandidate.candidateType,
              protocol: localCandidate.protocol,
              address: localCandidate.address,
              ip: localCandidate.ip,
              port: localCandidate.port,
              relayProtocol: localCandidate.relayProtocol,
              url: localCandidate.url
            }
            : null,
        remoteCandidate: remoteCandidate
            ? {
              candidateType: remoteCandidate.candidateType,
              protocol: remoteCandidate.protocol,
              address: remoteCandidate.address,
              ip: remoteCandidate.ip,
              port: remoteCandidate.port
            }
            : null
      });
    } catch (exception) {
      voiceError("Failed to read selected ICE candidate pair", exception);
    }
  }

  async function logAllCandidatePairs(userId: string, peer: RTCPeerConnection) {
    try {
      const report = await peer.getStats();
      const pairs: any[] = [];
      const candidates: Record<string, any> = {};

      report.forEach((stat: any) => {
        if (stat.type === "local-candidate" || stat.type === "remote-candidate") {
          candidates[stat.id] = {
            id: stat.id,
            type: stat.type,
            candidateType: stat.candidateType,
            protocol: stat.protocol,
            address: stat.address,
            ip: stat.ip,
            port: stat.port,
            relayProtocol: stat.relayProtocol,
            url: stat.url
          };
        }
      });

      report.forEach((stat: any) => {
        if (stat.type === "candidate-pair") {
          pairs.push({
            id: stat.id,
            state: stat.state,
            nominated: stat.nominated,
            selected: stat.selected,
            currentRoundTripTime: stat.currentRoundTripTime,
            requestsSent: stat.requestsSent,
            responsesReceived: stat.responsesReceived,
            requestsReceived: stat.requestsReceived,
            responsesSent: stat.responsesSent,
            bytesSent: stat.bytesSent,
            bytesReceived: stat.bytesReceived,
            localCandidate: candidates[stat.localCandidateId],
            remoteCandidate: candidates[stat.remoteCandidateId]
          });
        }
      });

      voiceLog("All ICE candidate pairs", {
        userId,
        pairs
      });
    } catch (exception) {
      voiceError("Failed to read all ICE candidate pairs", exception);
    }
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
    if (signalingState === "reconnecting" || signalingState === "unavailable") {
      return "bad";
    }
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
    if (signalingState === "reconnecting") {
      return "Reconnecting to server";
    }
    if (signalingState === "unavailable") {
      return "Server unavailable";
    }
    if (["Requesting microphone", "Loading RNNoise", "Noise filter fallback", "Microphone denied"].includes(voiceStatus)) {
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
    if (signalingState === "reconnecting") {
      return "Trying to restore voice session";
    }
    if (signalingState === "unavailable") {
      return "Signaling connection lost";
    }
    if (["Requesting microphone", "Loading RNNoise", "Noise filter fallback", "Microphone denied"].includes(voiceStatus)) {
      return voiceStatus;
    }
    const ping = averagePingMs();
    const loss = outboundPacketLossRate();
    if (ping == null) {
      return DEFAULT_VOICE_ROOM_NAME;
    }
    return `${ping} ms - ${loss?.toFixed(1) ?? "0.0"}% loss`;
  }

  function syncVoiceStatus() {
    if (!inVoice) {
      return;
    }
    const total = totalPeerCount();
    if (total === 0) {
      setVoiceStatus("Waiting for participants");
      return;
    }
    if (connectedPeerCount() === total) {
      setVoiceStatus("Connected");
      return;
    }
    setVoiceStatus("Connecting");
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
              <h1>Join Shlyapcord voice</h1>
              <p className="muted">Invite: <span>{inviteToken || "missing"}</span></p>
            </div>

            <form onSubmit={handleAuthSubmit}>
              <label>
                Login
                <input autoComplete="username" maxLength={50} onChange={(event) => setLogin(event.target.value)} value={login} />
              </label>

              {authMode === "register" && (
                  <label>
                    Nickname
                    <input maxLength={50} onChange={(event) => setNickname(event.target.value)} value={nickname} />
                  </label>
              )}

              <label>
                Password
                <input
                    autoComplete={authMode === "login" ? "current-password" : "new-password"}
                    maxLength={128}
                    minLength={6}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    value={password}
                />
              </label>

              {authMode === "register" && (
                  <label>
                    Repeat password
                    <input
                        autoComplete="new-password"
                        maxLength={128}
                        minLength={6}
                        onChange={(event) => setPasswordRepeat(event.target.value)}
                        type="password"
                        value={passwordRepeat}
                    />
                  </label>
              )}

              <button type="submit">{authMode === "register" ? "Create account" : "Sign in"}</button>
            </form>

            <button
                className="auth-mode-button"
                onClick={() => {
                  setAuthMode(authMode === "register" ? "login" : "register");
                  setError(null);
                }}
            >
              {authMode === "register" ? "Already have an account" : "Create account"}
            </button>

            <StatusLine status={status} error={error} />
          </section>
        </main>
    );
  }

  return (
      <main className="shell app-shell">
        <aside className="channel-sidebar">
          <section className="channel-group">
            <div className="channel-title">Voice channels</div>
            <button className={inVoice ? "channel-row active" : "channel-row"} onClick={inVoice ? undefined : joinVoice}>
              <Users size={17} />
              {DEFAULT_VOICE_ROOM_NAME}
              <span>{voiceUsers.length}</span>
            </button>
            <div className="channel-voice-users">
              {voiceUsers.map((user) => (
                  <button className="channel-voice-user" key={user.id} onClick={() => setSelectedUserId(user.id)}>
                    <UserAvatarView className="channel-voice-avatar" user={user} />
                    <span>{user.nickname}</span>
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
                  <div className="voice-connection-actions">
                <span className="voice-connection-action" title="Voice details">
                  <Monitor size={15} />
                </span>
                    <span className="voice-connection-action danger" onClick={(event) => {
                      event.stopPropagation();
                      leaveVoice();
                    }} title="Leave voice">
                  <PhoneOff size={15} />
                </span>
                  </div>
                </button>
            )}

            <div className="user-control-bar">
              <div className="user-mini">
                <UserAvatarView className="user-mini-avatar" user={currentUser} />
                <div>
                  <strong>{currentUser.nickname}</strong>
                  <span>{currentUser.status || "Online"}</span>
                </div>
              </div>
              <div className="user-control-actions">
                <button className="icon-button" onClick={toggleMute} disabled={!inVoice} title={muted ? "Unmute" : "Mute"}>
                  {muted ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
                <button className="icon-button" disabled title="Headphones">
                  <Headphones size={18} />
                </button>
                <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Settings">
                  <Settings size={18} />
                </button>
              </div>
            </div>
          </div>
        </aside>

        <section className="content">
          <div className={voiceStageClassName}>
            {voiceUsers.map((user) => (
                <article className="voice-tile" key={user.id}>
                  <UserAvatarView className="voice-avatar" user={user} />
                  <h3>{user.nickname}</h3>
                </article>
            ))}
          </div>

          <footer className="voice-footer">
            <span>{voiceUsers.length} in voice</span>
            <span>Shlyapcord v{__APP_VERSION__}</span>
          </footer>
        </section>

        <aside className="member-sidebar">
          <div className="member-heading">Online - {onlineUsers.length}</div>
          <div className="member-list">
            {onlineUsers.map((user) => (
                <article
                    className={user.inVoice ? "user-card in-voice clickable" : "user-card"}
                    key={user.id}
                    onClick={user.inVoice ? () => setSelectedUserId(user.id) : undefined}
                >
                  <UserAvatarView className="avatar" user={user} />
                  <div>
                    <h3>{user.nickname}</h3>
                    <p>{user.status || "Online"}</p>
                  </div>
                  <div className="user-icons">
                    {user.inVoice && <Volume2 size={17} />}
                    {user.muted && <MicOff size={17} />}
                  </div>
                </article>
            ))}
          </div>
          <div className="member-heading offline-heading">Offline - {offlineUsers.length}</div>
          <div className="member-list">
            {offlineUsers.map((user) => (
                <article className="user-card offline" key={user.id}>
                  <UserAvatarView className="avatar" user={user} />
                  <div>
                    <h3>{user.nickname}</h3>
                  </div>
                </article>
            ))}
          </div>
        </aside>

        {selectedUser && (
            <div className="modal-backdrop" onClick={() => setSelectedUserId(null)}>
              <section className="user-modal" onClick={(event) => event.stopPropagation()}>
                <div className="modal-user-header">
                  <UserAvatarView className="voice-avatar" user={selectedUser} />
                  <div>
                    <h3>{selectedUser.nickname}</h3>
                    <p>{selectedUser.status || (selectedUser.muted ? "Muted" : "In voice")}</p>
                    {selectedUser.id !== currentUser.id && (
                        <p>
                          Connection: {peerStatuses[selectedUser.id]?.connectionState ?? "not connected"} · ICE:{" "}
                          {peerStatuses[selectedUser.id]?.iceConnectionState ?? "new"}
                        </p>
                    )}
                  </div>
                </div>

                {selectedUser.id !== currentUser.id ? (
                    <SettingsSlider
                        ariaLabel={`Volume for ${selectedUser.nickname}`}
                        className="modal-volume-control"
                        label="Volume"
                        max={1000}
                        min={0}
                        onChange={(value) => changeUserVolume(selectedUser.id, value)}
                        step={5}
                        value={userVolumes[selectedUser.id] ?? 100}
                    />
                ) : (
                    <p className="modal-note">This is you.</p>
                )}

                <button className="modal-close" onClick={() => setSelectedUserId(null)}>Close</button>
              </section>
            </div>
        )}

        {settingsOpen && (
            <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
              <section className="settings-modal" onClick={(event) => event.stopPropagation()}>
                <nav className="settings-tabs" aria-label="Settings sections">
                  <button className={settingsTab === "profile" ? "settings-tab active" : "settings-tab"} onClick={() => setSettingsTab("profile")} title="Profile">
                    <UserRound size={22} />
                  </button>
                  <button className={settingsTab === "voice" ? "settings-tab active" : "settings-tab"} onClick={() => setSettingsTab("voice")} title="Voice">
                    <Mic size={22} />
                  </button>
                  <button className={settingsTab === "sound" ? "settings-tab active" : "settings-tab"} onClick={() => setSettingsTab("sound")} title="Sound">
                    <Volume2 size={22} />
                  </button>
                </nav>

                <div className="settings-panel">
                  <button className="settings-x" onClick={() => setSettingsOpen(false)} title="Close">x</button>

                  {settingsTab === "profile" && currentUser && (
                      <section className="settings-section profile-section">
                        <h3>Profile</h3>
                        <div className="profile-layout">
                          <div className="profile-fields">
                            <label className="settings-field profile-edit-field">
                              <span>Nickname <button className="inline-icon-button" onClick={() => startProfileEdit("nickname")} title="Edit nickname"><Pencil size={13} /></button></span>
                              <input
                                  disabled={editingProfileField !== "nickname"}
                                  maxLength={50}
                                  onBlur={editingProfileField === "nickname" ? cancelProfileEdit : undefined}
                                  onChange={(event) => setProfileNickname(event.target.value)}
                                  onKeyDown={(event) => void saveProfileOnEnter(event, "nickname")}
                                  value={profileNickname}
                              />
                            </label>

                            <label className="settings-field profile-edit-field">
                              <span>Status <button className="inline-icon-button" onClick={() => startProfileEdit("status")} title="Edit status"><Pencil size={13} /></button></span>
                              <input
                                  disabled={editingProfileField !== "status"}
                                  maxLength={50}
                                  onBlur={editingProfileField === "status" ? cancelProfileEdit : undefined}
                                  onChange={(event) => setProfileStatus(event.target.value)}
                                  onKeyDown={(event) => void saveProfileOnEnter(event, "status")}
                                  value={profileStatus}
                              />
                            </label>
                          </div>

                          <div className="profile-avatar-wrap">
                            <UserAvatarView className="profile-avatar" user={currentUser} />
                            <div className="profile-avatar-actions">
                              <label className="profile-avatar-action" title="Edit avatar">
                                <Pencil size={18} />
                                <input
                                    accept="image/jpeg,image/png,image/webp,image/gif"
                                    disabled={avatarSaving}
                                    onChange={(event) => {
                                      openAvatarCrop(event.target.files?.[0] ?? null);
                                      event.target.value = "";
                                    }}
                                    type="file"
                                />
                              </label>
                              <button className="profile-avatar-action" disabled={avatarSaving} onClick={deleteAvatar} title="Delete avatar">
                                <Trash2 size={18} />
                              </button>
                            </div>
                          </div>
                        </div>

                        <button className="settings-secondary-button danger-action settings-logout-button" onClick={() => setLogoutConfirmOpen(true)}>
                          Log out
                        </button>
                      </section>
                  )}

                  {settingsTab === "voice" && (
                      <section className="settings-section">
                        <h3>Voice</h3>
                        <label className="settings-field compact-settings-field">
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
                        {inVoice && <p className="modal-note">Change the filter before joining voice.</p>}
                      </section>
                  )}

                  {settingsTab === "sound" && (
                      <section className="settings-section">
                        <h3>Sound</h3>
                        <SettingsSlider
                            ariaLabel="UI sound volume"
                            className="sound-settings-field"
                            label="UI"
                            max={400}
                            min={0}
                            onChange={setUiSoundVolume}
                            step={10}
                            value={uiSoundVolume}
                        />
                      </section>
                  )}
                </div>
              </section>
            </div>
        )}

        {avatarDraft && (
            <div className="modal-backdrop" onClick={closeAvatarCrop}>
              <section className="avatar-crop-modal" onClick={(event) => event.stopPropagation()}>
                <div>
                  <h3>Avatar</h3>
                  <p>Choose visible area</p>
                </div>

                <div
                    className="avatar-crop-frame"
                    onPointerDown={(event) => {
                      avatarDragRef.current = { x: event.clientX, y: event.clientY };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      const lastPoint = avatarDragRef.current;
                      if (!lastPoint) {
                        return;
                      }
                      moveAvatarCrop(event.clientX - lastPoint.x, event.clientY - lastPoint.y);
                      avatarDragRef.current = { x: event.clientX, y: event.clientY };
                    }}
                    onPointerUp={() => {
                      avatarDragRef.current = null;
                    }}
                >
                  {avatarPreviewMode === "image" ? (
                      <img
                          alt=""
                          draggable={false}
                          onLoad={(event) => updateAvatarNaturalSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
                          src={avatarDraft.url}
                          style={avatarPreviewStyle(avatarDraft, avatarCropZoom, avatarCropOffset)}
                      />
                  ) : (
                      <canvas
                          aria-label="Avatar preview"
                          height={AVATAR_PREVIEW_SIZE}
                          ref={avatarCanvasRef}
                          width={AVATAR_PREVIEW_SIZE}
                      />
                  )}
                </div>

                <label className="settings-field">
                  <span>Zoom</span>
                  <input
                      max={3}
                      min={1}
                      onChange={(event) => setClampedAvatarZoom(Number(event.target.value))}
                      step={0.01}
                      type="range"
                      value={avatarCropZoom}
                  />
                </label>

                <div className="avatar-crop-actions">
                  <button className="settings-secondary-button" disabled={avatarSaving} onClick={closeAvatarCrop}>
                    Cancel
                  </button>
                  <button className="settings-secondary-button" disabled={avatarSaving} onClick={confirmAvatarCrop}>
                    {avatarSaving ? "Saving" : "Save avatar"}
                  </button>
                </div>
              </section>
            </div>
        )}

        {logoutConfirmOpen && (
            <div className="modal-backdrop" onClick={() => setLogoutConfirmOpen(false)}>
              <section className="confirm-modal" onClick={(event) => event.stopPropagation()}>
                <div>
                  <h3>Sign out</h3>
                  <p>You will leave voice and need to sign in again.</p>
                </div>

                <div className="confirm-actions">
                  <button className="settings-secondary-button" onClick={() => setLogoutConfirmOpen(false)}>
                    Cancel
                  </button>
                  <button className="settings-secondary-button danger-action" onClick={handleLogout}>
                    Sign out
                  </button>
                </div>
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
                  <p>Server connection: <strong>{signalingState}</strong></p>
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

function SettingsSlider({
                          ariaLabel,
                          className,
                          label,
                          max,
                          min,
                          onChange,
                          step,
                          value
                        }: {
  ariaLabel: string;
  className?: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
      <label className={["settings-slider", className].filter(Boolean).join(" ")}>
        <span>{label}</span>
        <div className="settings-slider-row">
          <span aria-hidden="true">-</span>
          <input
              aria-label={ariaLabel}
              max={max}
              min={min}
              onChange={(event) => onChange(Number(event.target.value))}
              step={step}
              type="range"
              value={value}
          />
          <span aria-hidden="true">+</span>
        </div>
      </label>
  );
}

function UserAvatarView({ user, className }: { user: Pick<User, "id" | "nickname" | "avatarUpdatedAt">; className: string }) {
  const src = user.avatarUpdatedAt
      ? `/api/users/${encodeURIComponent(user.id)}/avatar?v=${encodeURIComponent(user.avatarUpdatedAt)}`
      : null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const visibleSrc = src && failedSrc !== src ? src : null;

  useEffect(() => {
    setFailedSrc(null);
  }, [src]);

  return (
      <div className={className}>
        {visibleSrc ? <img alt="" onError={() => setFailedSrc(visibleSrc)} src={visibleSrc} /> : user.nickname.slice(0, 1).toUpperCase()}
      </div>
  );
}

function clampAvatarOffset(offset: Point, zoom: number, draft: AvatarDraft | null): Point {
  if (!draft || draft.naturalWidth <= 0 || draft.naturalHeight <= 0) {
    return offset;
  }
  const scale = avatarBaseScale(draft) * zoom;
  const maxX = Math.max(0, (draft.naturalWidth * scale - AVATAR_CROP_SIZE) / 2);
  const maxY = Math.max(0, (draft.naturalHeight * scale - AVATAR_CROP_SIZE) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y))
  };
}

function avatarBaseScale(draft: AvatarDraft) {
  return Math.max(AVATAR_CROP_SIZE / draft.naturalWidth, AVATAR_CROP_SIZE / draft.naturalHeight);
}

function avatarPreviewStyle(draft: AvatarDraft, zoom: number, offset: Point): React.CSSProperties {
  if (draft.naturalWidth <= 0 || draft.naturalHeight <= 0) {
    return {};
  }
  const scale = avatarBaseScale(draft) * zoom;
  return {
    height: `${draft.naturalHeight * scale}px`,
    transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
    width: `${draft.naturalWidth * scale}px`
  };
}

function drawAvatarPreview(
    image: CanvasImageSource,
    canvas: HTMLCanvasElement | null,
    naturalWidth: number,
    naturalHeight: number,
    zoom: number,
    offset: Point
) {
  if (!canvas || naturalWidth <= 0 || naturalHeight <= 0) {
    return;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const pixelRatio = window.devicePixelRatio || 1;
  const targetSize = AVATAR_PREVIEW_SIZE * pixelRatio;
  if (canvas.width !== targetSize || canvas.height !== targetSize) {
    canvas.width = targetSize;
    canvas.height = targetSize;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, AVATAR_PREVIEW_SIZE, AVATAR_PREVIEW_SIZE);
  const scale = Math.max(AVATAR_CROP_SIZE / naturalWidth, AVATAR_CROP_SIZE / naturalHeight) * zoom;
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  const x = AVATAR_PREVIEW_SIZE / 2 - width / 2 + offset.x;
  const y = AVATAR_PREVIEW_SIZE / 2 - height / 2 + offset.y;
  context.drawImage(image, x, y, width, height);
}

function avatarSourceCrop(draft: AvatarDraft, zoom: number, offset: Point): AvatarCrop {
  const scale = avatarBaseScale(draft) * zoom;
  const sourceSize = AVATAR_CROP_SIZE / scale;
  const sourceX = clampNumber(
      draft.naturalWidth / 2 + (0 - AVATAR_CROP_SIZE / 2 - offset.x) / scale,
      0,
      draft.naturalWidth - sourceSize
  );
  const sourceY = clampNumber(
      draft.naturalHeight / 2 + (0 - AVATAR_CROP_SIZE / 2 - offset.y) / scale,
      0,
      draft.naturalHeight - sourceSize
  );
  return {
    x: Math.max(0, Math.round(sourceX)),
    y: Math.max(0, Math.round(sourceY)),
    size: Math.max(1, Math.round(sourceSize))
  };
}

async function createCroppedAvatarFile(draft: AvatarDraft, crop: AvatarCrop) {
  const image = await loadImage(draft.url);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available");
  }
  context.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Failed to prepare avatar")), "image/png", 0.92);
  });
  return new File([blob], "avatar.png", { type: "image/png" });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to read avatar image"));
    image.src = src;
  });
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    let message = response.status === 403 ? "403 Forbidden" : `Request failed: ${response.status}`;
    try {
      const payload = await response.json();
      if (typeof payload?.message === "string" && payload.message.trim()) {
        message = payload.message;
      }
    } catch {
      // Non-JSON errors keep the status-based message.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

function authHeaders(accessToken: string | null): HeadersInit {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

async function apiForm<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(response.status === 403 ? "403 Forbidden" : `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function readStoredNumber(key: string, fallback: number) {
  const value = window.localStorage.getItem(key);
  if (value == null) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
);
