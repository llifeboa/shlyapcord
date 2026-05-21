package dev.shlyapcord.service;

import dev.shlyapcord.config.AppProperties;
import dev.shlyapcord.entity.RefreshToken;
import dev.shlyapcord.entity.UserAccount;
import dev.shlyapcord.repository.RefreshTokenRepository;
import jakarta.annotation.PostConstruct;
import jakarta.transaction.Transactional;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;

@Service
public class RefreshTokenService {
    public static final String COOKIE_NAME = "refresh_token";
    public static final Duration REFRESH_TTL = Duration.ofDays(365);

    private final RefreshTokenRepository refreshTokenRepository;
    private final AppProperties appProperties;
    private final SecureRandom secureRandom = new SecureRandom();
    private SecretKeySpec hmacKey;

    public RefreshTokenService(RefreshTokenRepository refreshTokenRepository, AppProperties appProperties) {
        this.refreshTokenRepository = refreshTokenRepository;
        this.appProperties = appProperties;
    }

    @PostConstruct
    void init() {
        String secret = appProperties.getAuth().getRefreshHmacSecret();
        if (secret == null || secret.length() < 32) {
            throw new IllegalStateException("REFRESH_HMAC_SECRET must be at least 32 characters");
        }
        hmacKey = new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    @Transactional
    public IssuedRefreshToken issue(UserAccount user, String userAgent, String ipAddress) {
        revokeActiveForUser(user);

        String rawToken = generateRawToken();
        Instant now = Instant.now();
        RefreshToken refreshToken = new RefreshToken();
        refreshToken.setId(UUID.randomUUID());
        refreshToken.setUser(user);
        refreshToken.setSessionId(UUID.randomUUID());
        refreshToken.setTokenHash(hash(rawToken));
        refreshToken.setCreatedAt(now);
        refreshToken.setExpiresAt(now.plus(REFRESH_TTL));
        refreshToken.setUserAgent(userAgent);
        refreshToken.setIpAddress(ipAddress);
        refreshTokenRepository.save(refreshToken);
        return new IssuedRefreshToken(rawToken, refreshToken);
    }

    public Optional<RefreshToken> findActive(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            return Optional.empty();
        }
        Instant now = Instant.now();
        return refreshTokenRepository.findByTokenHash(hash(rawToken))
            .filter(token -> token.isActiveAt(now));
    }

    @Transactional
    public void revoke(RefreshToken refreshToken) {
        if (refreshToken.getRevokedAt() == null) {
            refreshToken.setRevokedAt(Instant.now());
            refreshTokenRepository.save(refreshToken);
        }
    }

    @Transactional
    public void revokeActiveForUser(UserAccount user) {
        Instant now = Instant.now();
        for (RefreshToken token : refreshTokenRepository.findAllByUserAndRevokedAtIsNull(user)) {
            token.setRevokedAt(now);
        }
    }

    public String hash(String rawToken) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(hmacKey);
            return HexFormat.of().formatHex(mac.doFinal(rawToken.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("Failed to hash refresh token", exception);
        }
    }

    private String generateRawToken() {
        byte[] bytes = new byte[48];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public record IssuedRefreshToken(String rawToken, RefreshToken entity) {
    }
}
