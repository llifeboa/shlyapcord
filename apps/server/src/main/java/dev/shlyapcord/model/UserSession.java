package dev.shlyapcord.model;

import lombok.Getter;
import lombok.Setter;
import org.springframework.web.socket.WebSocketSession;

@Getter
public class UserSession {
    private final String id;
    @Setter
    private volatile String nickname;
    @Setter
    private volatile String status;
    private final WebSocketSession socketSession;
    @Setter
    private volatile boolean inVoice;
    @Setter
    private volatile boolean muted;

    public UserSession(String id, String nickname, String status, WebSocketSession socketSession) {
        this.id = id;
        this.nickname = nickname;
        this.status = status;
        this.socketSession = socketSession;
    }
}
