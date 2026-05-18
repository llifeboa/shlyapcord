package dev.shlyapcord.service;

import dev.shlyapcord.model.UserSession;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.WebSocketSession;

@Service
public class UserSessionService {
    private final Map<String, UserSession> usersById = new ConcurrentHashMap<>();
    private final Map<String, String> userIdBySocketSessionId = new ConcurrentHashMap<>();

    public UserSession create(String name, String inviteToken, WebSocketSession socketSession) {
        UserSession user = new UserSession(UUID.randomUUID().toString(), name, inviteToken, socketSession);
        usersById.put(user.getId(), user);
        userIdBySocketSessionId.put(socketSession.getId(), user.getId());
        return user;
    }

    public Optional<UserSession> findBySocketSessionId(String socketSessionId) {
        String userId = userIdBySocketSessionId.get(socketSessionId);
        if (userId == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(usersById.get(userId));
    }

    public Optional<UserSession> findById(String userId) {
        return Optional.ofNullable(usersById.get(userId));
    }

    public Collection<UserSession> all() {
        return usersById.values();
    }

    public Collection<UserSession> voiceUsers() {
        return usersById.values().stream().filter(UserSession::isInVoice).toList();
    }

    public Optional<UserSession> removeBySocketSessionId(String socketSessionId) {
        String userId = userIdBySocketSessionId.remove(socketSessionId);
        if (userId == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(usersById.remove(userId));
    }

    public Map<String, Object> toPublicUser(UserSession user) {
        Map<String, Object> publicUser = new LinkedHashMap<>();
        publicUser.put("id", user.getId());
        publicUser.put("name", user.getName());
        publicUser.put("joinedAt", user.getJoinedAt().toString());
        publicUser.put("inVoice", user.isInVoice());
        publicUser.put("muted", user.isMuted());
        return publicUser;
    }
}
