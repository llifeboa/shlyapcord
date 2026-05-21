package dev.shlyapcord.controller;

import dev.shlyapcord.service.InviteService;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequiredArgsConstructor
public class HealthController {
    private final InviteService inviteService;

    @GetMapping("/api/health")
    public Map<String, String> health() {
        return Map.of("status", "ok", "service", "shlyapcord-server");
    }

    @GetMapping("/api/invites/{token}")
    public Map<String, Boolean> invite(@PathVariable String token) {
        if (!inviteService.isValid(token)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        return Map.of("valid", true);
    }
}
