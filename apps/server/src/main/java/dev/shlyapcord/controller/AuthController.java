package dev.shlyapcord.controller;

import dev.shlyapcord.config.AppProperties;
import dev.shlyapcord.dto.AuthDtos.AuthResponse;
import dev.shlyapcord.dto.AuthDtos.LoginRequest;
import dev.shlyapcord.dto.AuthDtos.RegisterRequest;
import dev.shlyapcord.dto.AuthDtos.RegisterResponse;
import dev.shlyapcord.dto.AuthDtos.UserResponse;
import dev.shlyapcord.service.AuthException;
import dev.shlyapcord.service.AuthService;
import dev.shlyapcord.service.RefreshTokenService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {
    private final AuthService authService;
    private final AppProperties appProperties;

    @PostMapping("/register")
    public RegisterResponse register(@Valid @RequestBody RegisterRequest request) {
        return authService.register(request);
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(
        @Valid @RequestBody LoginRequest request,
        @RequestHeader(value = "User-Agent", required = false) String userAgent,
        HttpServletRequest servletRequest
    ) {
        AuthService.LoginResult result = authService.login(request, userAgent, clientIp(servletRequest));
        return ResponseEntity.ok()
            .header(HttpHeaders.SET_COOKIE, refreshCookie(result.rawRefreshToken()).toString())
            .body(result.response());
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refresh(
        @CookieValue(value = RefreshTokenService.COOKIE_NAME, required = false) String rawRefreshToken
    ) {
        try {
            return ResponseEntity.ok(authService.refresh(rawRefreshToken));
        } catch (AuthException exception) {
            return ResponseEntity.status(exception.getStatus())
                .header(HttpHeaders.SET_COOKIE, clearRefreshCookie().toString())
                .build();
        }
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(
        @CookieValue(value = RefreshTokenService.COOKIE_NAME, required = false) String rawRefreshToken
    ) {
        authService.logout(rawRefreshToken);
        return ResponseEntity.noContent()
            .header(HttpHeaders.SET_COOKIE, clearRefreshCookie().toString())
            .build();
    }

    @GetMapping("/me")
    public UserResponse me(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
        return authService.me(authorization);
    }

    private ResponseCookie refreshCookie(String value) {
        return ResponseCookie.from(RefreshTokenService.COOKIE_NAME, value)
            .httpOnly(true)
            .secure(appProperties.getAuth().isRefreshCookieSecure())
            .sameSite("Strict")
            .path("/api/auth")
            .maxAge(RefreshTokenService.REFRESH_TTL)
            .build();
    }

    private ResponseCookie clearRefreshCookie() {
        return ResponseCookie.from(RefreshTokenService.COOKIE_NAME, "")
            .httpOnly(true)
            .secure(appProperties.getAuth().isRefreshCookieSecure())
            .sameSite("Strict")
            .path("/api/auth")
            .maxAge(0)
            .build();
    }

    private String clientIp(HttpServletRequest request) {
        String forwardedFor = request.getHeader("X-Forwarded-For");
        if (forwardedFor != null && !forwardedFor.isBlank()) {
            return forwardedFor.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
