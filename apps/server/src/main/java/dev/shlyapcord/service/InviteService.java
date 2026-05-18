package dev.shlyapcord.service;

import dev.shlyapcord.config.AppProperties;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

@Service
public class InviteService {
    private final Set<String> validTokens;

    public InviteService(AppProperties appProperties) {
        this.validTokens = appProperties.getInvites().stream()
            .filter(token -> token != null && !token.isBlank())
            .map(String::trim)
            .collect(Collectors.toUnmodifiableSet());
    }

    public boolean isValid(String token) {
        return token != null && validTokens.contains(token.trim());
    }
}
