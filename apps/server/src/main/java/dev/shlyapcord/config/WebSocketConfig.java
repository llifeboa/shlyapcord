package dev.shlyapcord.config;

import dev.shlyapcord.websocket.SignalingWebSocketHandler;
import java.util.List;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
@EnableConfigurationProperties(AppProperties.class)
public class WebSocketConfig implements WebSocketConfigurer {
    private final SignalingWebSocketHandler signalingWebSocketHandler;
    private final AppProperties appProperties;

    public WebSocketConfig(SignalingWebSocketHandler signalingWebSocketHandler, AppProperties appProperties) {
        this.signalingWebSocketHandler = signalingWebSocketHandler;
        this.appProperties = appProperties;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        List<String> origins = appProperties.getCorsOrigins();
        registry.addHandler(signalingWebSocketHandler, "/ws")
            .setAllowedOriginPatterns(origins.toArray(String[]::new));
    }
}
