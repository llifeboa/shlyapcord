package dev.shlyapcord.model;

import java.time.Instant;
import org.springframework.web.socket.WebSocketSession;

public class UserSession {
    private final String id;
    private final String name;
    private final String inviteToken;
    private final Instant joinedAt;
    private final WebSocketSession socketSession;
    private volatile boolean inVoice;
    private volatile boolean muted;

    public UserSession(String id, String name, String inviteToken, WebSocketSession socketSession) {
        this.id = id;
        this.name = name;
        this.inviteToken = inviteToken;
        this.socketSession = socketSession;
        this.joinedAt = Instant.now();
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getInviteToken() {
        return inviteToken;
    }

    public Instant getJoinedAt() {
        return joinedAt;
    }

    public WebSocketSession getSocketSession() {
        return socketSession;
    }

    public boolean isInVoice() {
        return inVoice;
    }

    public void setInVoice(boolean inVoice) {
        this.inVoice = inVoice;
    }

    public boolean isMuted() {
        return muted;
    }

    public void setMuted(boolean muted) {
        this.muted = muted;
    }
}
