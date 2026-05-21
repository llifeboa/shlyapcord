package dev.shlyapcord.service;

import dev.shlyapcord.dto.AuthDtos.AuthResponse;
import dev.shlyapcord.dto.AuthDtos.LoginRequest;
import dev.shlyapcord.dto.AuthDtos.RegisterRequest;
import dev.shlyapcord.dto.AuthDtos.RegisterResponse;
import dev.shlyapcord.dto.AuthDtos.UserResponse;
import dev.shlyapcord.entity.RefreshToken;
import dev.shlyapcord.entity.UserAccount;
import dev.shlyapcord.repository.RefreshTokenRepository;
import dev.shlyapcord.repository.UserAccountRepository;
import dev.shlyapcord.security.JwtClaims;
import dev.shlyapcord.security.JwtService;
import dev.shlyapcord.security.JwtValidationException;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AuthService {
    private static final Pattern LOGIN_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{1,50}$");

    private final InviteService inviteService;
    private final UserAccountRepository userAccountRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final RefreshTokenService refreshTokenService;
    private final JwtService jwtService;
    private final PasswordEncoder passwordEncoder;

    @Transactional
    public RegisterResponse register(RegisterRequest request) {
        requireInvite(request.inviteToken());
        String login = normalizeLogin(request.login());
        String nickname = normalizeNickname(request.nickname(), login);
        validatePasswordRepeat(request.password(), request.passwordRepeat());

        if (userAccountRepository.existsByLogin(login)) {
            throw new AuthException(HttpStatus.CONFLICT, "Login already exists");
        }

        Instant now = Instant.now();
        UserAccount user = new UserAccount();
        user.setId(UUID.randomUUID());
        user.setLogin(login);
        user.setNickname(nickname);
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setCreatedAt(now);
        user.setUpdatedAt(now);
        userAccountRepository.save(user);
        return new RegisterResponse(toUserResponse(user));
    }

    @Transactional
    public LoginResult login(LoginRequest request, String userAgent, String ipAddress) {
        requireInvite(request.inviteToken());
        String login = normalizeLogin(request.login());
        UserAccount user = userAccountRepository.findByLogin(login)
            .orElseThrow(() -> new AuthException(HttpStatus.UNAUTHORIZED, "Invalid login or password"));
        ensureEnabled(user);
        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new AuthException(HttpStatus.UNAUTHORIZED, "Invalid login or password");
        }

        RefreshTokenService.IssuedRefreshToken refreshToken = refreshTokenService.issue(user, userAgent, ipAddress);
        String accessToken = jwtService.issueAccessToken(user, refreshToken.entity().getSessionId());
        return new LoginResult(new AuthResponse(accessToken, toUserResponse(user)), refreshToken.rawToken());
    }

    @Transactional
    public AuthResponse refresh(String rawRefreshToken) {
        RefreshToken refreshToken = refreshTokenService.findActive(rawRefreshToken)
            .orElseThrow(() -> new AuthException(HttpStatus.UNAUTHORIZED, "Invalid refresh token"));
        UserAccount user = refreshToken.getUser();
        ensureEnabled(user);
        String accessToken = jwtService.issueAccessToken(user, refreshToken.getSessionId());
        return new AuthResponse(accessToken, toUserResponse(user));
    }

    @Transactional
    public void logout(String rawRefreshToken) {
        refreshTokenService.findActive(rawRefreshToken).ifPresent(refreshTokenService::revoke);
    }

    @Transactional
    public UserResponse me(String authorizationHeader) {
        UserAccount user = authenticateAuthorizationHeader(authorizationHeader);
        return toUserResponse(user);
    }

    @Transactional
    public UserAccount authenticateAuthorizationHeader(String authorizationHeader) {
        return authenticateClaims(requireAccessToken(authorizationHeader));
    }

    @Transactional
    public UserAccount reloadUser(UserAccount user) {
        UserAccount reloaded = userAccountRepository.findById(user.getId())
            .orElseThrow(() -> new AuthException(HttpStatus.UNAUTHORIZED, "Invalid user"));
        ensureEnabled(reloaded);
        return reloaded;
    }

    @Transactional
    public UserAccount authenticateAccessToken(String accessToken) {
        JwtClaims claims;
        try {
            claims = jwtService.validate(accessToken);
        } catch (JwtValidationException exception) {
            throw new AuthException(HttpStatus.UNAUTHORIZED, exception.getMessage());
        }
        return authenticateClaims(claims);
    }

    private UserAccount authenticateClaims(JwtClaims claims) {
        UserAccount user = userAccountRepository.findById(claims.userId())
            .orElseThrow(() -> new AuthException(HttpStatus.UNAUTHORIZED, "Invalid access token"));
        ensureEnabled(user);
        RefreshToken refreshToken = refreshTokenRepository.findBySessionIdAndRevokedAtIsNull(claims.sessionId())
            .orElseThrow(() -> new AuthException(HttpStatus.UNAUTHORIZED, "Session revoked"));
        if (!refreshToken.getUser().getId().equals(user.getId()) || !refreshToken.isActiveAt(Instant.now())) {
            throw new AuthException(HttpStatus.UNAUTHORIZED, "Session revoked");
        }
        return user;
    }

    private JwtClaims requireAccessToken(String authorizationHeader) {
        if (authorizationHeader == null || !authorizationHeader.startsWith("Bearer ")) {
            throw new AuthException(HttpStatus.UNAUTHORIZED, "Access token is required");
        }
        try {
            return jwtService.validate(authorizationHeader.substring("Bearer ".length()).trim());
        } catch (JwtValidationException exception) {
            throw new AuthException(HttpStatus.UNAUTHORIZED, exception.getMessage());
        }
    }

    private void requireInvite(String inviteToken) {
        if (!inviteService.isValid(inviteToken)) {
            throw new AuthException(HttpStatus.FORBIDDEN, "Forbidden");
        }
    }

    private String normalizeLogin(String rawLogin) {
        String login = rawLogin == null ? "" : rawLogin.trim().toLowerCase(Locale.ROOT);
        if (!LOGIN_PATTERN.matcher(login).matches()) {
            throw new AuthException(HttpStatus.BAD_REQUEST, "Login must be 1-50 characters: latin, digits, _ or -");
        }
        return login;
    }

    private String normalizeNickname(String rawNickname, String fallbackLogin) {
        String nickname = rawNickname == null ? "" : rawNickname.trim();
        if (nickname.isEmpty()) {
            return fallbackLogin;
        }
        if (nickname.length() > 50) {
            throw new AuthException(HttpStatus.BAD_REQUEST, "Nickname must be 1-50 characters");
        }
        return nickname;
    }

    private void validatePasswordRepeat(String password, String passwordRepeat) {
        if (password == null || password.length() < 6 || password.length() > 128) {
            throw new AuthException(HttpStatus.BAD_REQUEST, "Password must be 6-128 characters");
        }
        if (!password.equals(passwordRepeat)) {
            throw new AuthException(HttpStatus.BAD_REQUEST, "Passwords do not match");
        }
    }

    private void ensureEnabled(UserAccount user) {
        if (user.isDisabled()) {
            throw new AuthException(HttpStatus.FORBIDDEN, "User is disabled");
        }
    }

    private UserResponse toUserResponse(UserAccount user) {
        return new UserResponse(user.getId(), user.getLogin(), user.getNickname(), user.getStatus(), user.getAvatarUpdatedAt());
    }

    public record LoginResult(AuthResponse response, String rawRefreshToken) {
    }
}
