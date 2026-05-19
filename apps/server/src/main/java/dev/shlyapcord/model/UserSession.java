package dev.shlyapcord.model;

import java.time.Instant;
import lombok.Getter;
import lombok.Setter;
import org.springframework.web.socket.WebSocketSession;

@Getter
public class UserSession {
    private final String id;
    private final String name;
    private final String inviteToken;
    private final Instant joinedAt;
    private final WebSocketSession socketSession;
    @Setter
    private volatile boolean inVoice;
    @Setter
    private volatile boolean muted;

    public UserSession(String id, String name, String inviteToken, WebSocketSession socketSession) {
        this.id = id;
        this.name = name;
        this.inviteToken = inviteToken;
        this.socketSession = socketSession;
        this.joinedAt = Instant.now();
    }
}
