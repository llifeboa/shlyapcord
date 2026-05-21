package dev.shlyapcord.security;

import java.time.Instant;
import java.util.UUID;

public record JwtClaims(
    UUID userId,
    UUID sessionId,
    String login,
    String nickname,
    Instant issuedAt,
    Instant expiresAt
) {
}
