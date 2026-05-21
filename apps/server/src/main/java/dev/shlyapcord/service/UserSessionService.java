package dev.shlyapcord.service;

import dev.shlyapcord.entity.UserAccount;
import dev.shlyapcord.model.UserSession;
import dev.shlyapcord.repository.UserAccountRepository;
import java.io.IOException;
import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

@Service
@RequiredArgsConstructor
public class UserSessionService {
    private final UserAccountRepository userAccountRepository;
    private final Map<String, UserSession> usersById = new ConcurrentHashMap<>();
    private final Map<String, String> userIdBySocketSessionId = new ConcurrentHashMap<>();

    public UserSession createAuthenticated(UserAccount account, WebSocketSession socketSession) {
        String userId = account.getId().toString();
        UserSession previous = usersById.remove(userId);
        if (previous != null) {
            userIdBySocketSessionId.remove(previous.getSocketSession().getId());
            closeLoggedInElsewhere(previous.getSocketSession());
        }

        UserSession user = new UserSession(userId, account.getNickname(), account.getStatus(), socketSession);
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

    public void updateNickname(UserAccount account) {
        UserSession session = usersById.get(account.getId().toString());
        if (session != null) {
            session.setNickname(account.getNickname());
            session.setStatus(account.getStatus());
        }
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
        Instant avatarUpdatedAt = findAvatarTimestamp(user.getId());
        Map<String, Object> publicUser = new LinkedHashMap<>();
        publicUser.put("id", user.getId());
        publicUser.put("nickname", user.getNickname());
        publicUser.put("status", user.getStatus());
        publicUser.put("online", true);
        publicUser.put("inVoice", user.isInVoice());
        publicUser.put("muted", user.isMuted());
        publicUser.put("avatarUpdatedAt", avatarUpdatedAt);
        return publicUser;
    }

    public Collection<Map<String, Object>> publicUsers() {
        return userAccountRepository.findAllByDisabledFalseOrderByNicknameAsc().stream()
            .map(this::toPublicUser)
            .toList();
    }

    public Map<String, Object> toPublicUser(UserAccount account) {
        UserSession session = usersById.get(account.getId().toString());
        Map<String, Object> publicUser = new LinkedHashMap<>();
        publicUser.put("id", account.getId().toString());
        publicUser.put("nickname", account.getNickname());
        publicUser.put("status", account.getStatus());
        publicUser.put("avatarUpdatedAt", account.getAvatarUpdatedAt());
        publicUser.put("online", session != null);
        publicUser.put("inVoice", session != null && session.isInVoice());
        publicUser.put("muted", session != null && session.isMuted());
        return publicUser;
    }

    private void closeLoggedInElsewhere(WebSocketSession socketSession) {
        try {
            if (socketSession.isOpen()) {
                socketSession.close(new CloseStatus(4409, "logged in from another device"));
            }
        } catch (IOException ignored) {
            // The old socket is already closing; replacing the session should continue.
        }
    }

    private Instant findAvatarTimestamp(String userId) {
        try {
            return userAccountRepository.findById(UUID.fromString(userId))
                .map(UserAccount::getAvatarUpdatedAt)
                .orElse(null);
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }
}
