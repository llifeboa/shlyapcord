package dev.shlyapcord.websocket;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.shlyapcord.model.ClientMessage;
import dev.shlyapcord.model.UserSession;
import dev.shlyapcord.service.InviteService;
import dev.shlyapcord.service.UserSessionService;
import java.io.IOException;
import java.util.Collection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Component
@RequiredArgsConstructor
public class SignalingWebSocketHandler extends TextWebSocketHandler {
    private final ObjectMapper objectMapper;
    private final InviteService inviteService;
    private final UserSessionService userSessionService;
    private final ConcurrentMap<String, Object> sendLocks = new ConcurrentHashMap<>();

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        ClientMessage clientMessage = objectMapper.readValue(message.getPayload(), ClientMessage.class);
        if ("system.ping".equals(clientMessage.getType())) {
            send(session, "system.pong", Map.of("timestamp", System.currentTimeMillis()));
            return;
        }

        if ("auth.join".equals(clientMessage.getType())) {
            handleAuthJoin(session, clientMessage.getPayload());
            return;
        }

        UserSession sender = userSessionService.findBySocketSessionId(session.getId()).orElse(null);
        if (sender == null) {
            send(session, "error", Map.of("message", "Not authenticated"));
            return;
        }

        switch (clientMessage.getType()) {
            case "voice.join" -> handleVoiceJoin(sender);
            case "voice.leave" -> handleVoiceLeave(sender);
            case "voice.mute" -> handleVoiceMute(sender, clientMessage.getPayload());
            case "webrtc.offer", "webrtc.answer", "webrtc.iceCandidate" ->
                forwardToTarget(sender, clientMessage);
            default -> send(session, "error", Map.of("message", "Unknown message type"));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        UserSession user = userSessionService.removeBySocketSessionId(session.getId()).orElse(null);
        sendLocks.remove(session.getId());
        if (user != null) {
            broadcast("user.left", Map.of("userId", user.getId()));
            broadcastUsersList();
        }
    }

    private void handleAuthJoin(WebSocketSession session, JsonNode payload) throws IOException {
        String inviteToken = text(payload, "inviteToken");
        String name = text(payload, "name");

        if (!inviteService.isValid(inviteToken)) {
            send(session, "auth.error", Map.of("message", "Invite link is invalid"));
            return;
        }
        if (name == null || name.isBlank() || name.length() > 40) {
            send(session, "auth.error", Map.of("message", "Name must be 1-40 characters"));
            return;
        }

        UserSession user = userSessionService.create(name.trim(), inviteToken, session);
        send(session, "auth.ok", Map.of("user", userSessionService.toPublicUser(user)));
        sendUsersList(session);
        broadcastExcept(user.getId(), "user.joined", Map.of("user", userSessionService.toPublicUser(user)));
    }

    private void handleVoiceJoin(UserSession user) throws IOException {
        user.setInVoice(true);
        user.setMuted(false);
        send(user.getSocketSession(), "voice.users", Map.of(
            "users",
            userSessionService.voiceUsers().stream()
                .filter(voiceUser -> !voiceUser.getId().equals(user.getId()))
                .map(userSessionService::toPublicUser)
                .toList()
        ));
        broadcastExcept(user.getId(), "voice.userJoined", Map.of("user", userSessionService.toPublicUser(user)));
        broadcastUsersList();
    }

    private void handleVoiceLeave(UserSession user) throws IOException {
        user.setInVoice(false);
        user.setMuted(false);
        broadcast("voice.userLeft", Map.of("userId", user.getId()));
        broadcastUsersList();
    }

    private void handleVoiceMute(UserSession user, JsonNode payload) throws IOException {
        user.setMuted(payload != null && payload.path("muted").asBoolean(false));
        broadcast("voice.userMuted", Map.of("userId", user.getId(), "muted", user.isMuted()));
        broadcastUsersList();
    }

    private void forwardToTarget(UserSession sender, ClientMessage clientMessage) throws IOException {
        if (clientMessage.getTargetUserId() == null) {
            send(sender.getSocketSession(), "error", Map.of("message", "targetUserId is required"));
            return;
        }

        UserSession target = userSessionService.findById(clientMessage.getTargetUserId()).orElse(null);
        if (target == null) {
            send(sender.getSocketSession(), "error", Map.of("message", "Target user is offline"));
            return;
        }

        send(target.getSocketSession(), clientMessage.getType(), Map.of(
            "sourceUserId", sender.getId(),
            "payload", clientMessage.getPayload()
        ));
    }

    private void sendUsersList(WebSocketSession session) throws IOException {
        send(session, "users.list", Map.of("users", publicUsers(userSessionService.all())));
    }

    private void broadcastUsersList() throws IOException {
        broadcast("users.list", Map.of("users", publicUsers(userSessionService.all())));
    }

    private Collection<Map<String, Object>> publicUsers(Collection<UserSession> users) {
        return users.stream().map(userSessionService::toPublicUser).toList();
    }

    private void broadcast(String type, Object payload) throws IOException {
        for (UserSession user : userSessionService.all()) {
            send(user.getSocketSession(), type, payload);
        }
    }

    private void broadcastExcept(String excludedUserId, String type, Object payload) throws IOException {
        for (UserSession user : userSessionService.all()) {
            if (!user.getId().equals(excludedUserId)) {
                send(user.getSocketSession(), type, payload);
            }
        }
    }

    private void send(WebSocketSession session, String type, Object payload) throws IOException {
        if (!session.isOpen()) {
            return;
        }
        TextMessage message = new TextMessage(objectMapper.writeValueAsString(Map.of(
            "type", type,
            "payload", payload
        )));

        Object lock = sendLocks.computeIfAbsent(session.getId(), ignored -> new Object());
        synchronized (lock) {
            try {
                if (session.isOpen()) {
                    session.sendMessage(message);
                }
            } catch (IOException | RuntimeException ignored) {
                // A stale or concurrently closing session must not tear down the sender's handler thread.
            }
        }
    }

    private String text(JsonNode payload, String field) {
        if (payload == null || payload.get(field) == null) {
            return null;
        }
        return payload.get(field).asText();
    }
}
