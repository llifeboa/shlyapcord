package dev.shlyapcord.controller;

import dev.shlyapcord.config.AppProperties;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class IceController {
    private final AppProperties appProperties;

    @GetMapping("/api/ice")
    public Map<String, Object> ice() {
        List<Map<String, Object>> iceServers = new ArrayList<>();
        AppProperties.Ice ice = appProperties.getIce();
        if (hasText(ice.getStunUrl())) {
            iceServers.add(Map.of("urls", ice.getStunUrl()));
        }
        if (hasText(ice.getTurnUrl())) {
            Map<String, Object> turn = new LinkedHashMap<>();
            turn.put("urls", ice.getTurnUrl());
            turn.put("username", ice.getTurnUsername());
            turn.put("credential", ice.getTurnCredential());
            iceServers.add(turn);
        }
        return Map.of("iceServers", iceServers);
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
