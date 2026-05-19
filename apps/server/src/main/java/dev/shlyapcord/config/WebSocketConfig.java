package dev.shlyapcord.config;

import dev.shlyapcord.websocket.SignalingWebSocketHandler;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
@EnableConfigurationProperties(AppProperties.class)
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketConfigurer {
    private final SignalingWebSocketHandler signalingWebSocketHandler;
    private final AppProperties appProperties;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        List<String> origins = appProperties.getCorsOrigins();
        registry.addHandler(signalingWebSocketHandler, "/ws")
            .setAllowedOriginPatterns(origins.toArray(String[]::new));
    }
}
