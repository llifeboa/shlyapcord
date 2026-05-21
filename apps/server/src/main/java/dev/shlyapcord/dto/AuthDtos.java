package dev.shlyapcord.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

public final class AuthDtos {
    private AuthDtos() {
    }

    public record RegisterRequest(
        @NotBlank String inviteToken,
        @NotBlank @Size(min = 1, max = 50) String login,
        @Size(max = 50) String nickname,
        @NotBlank @Size(min = 6, max = 128) String password,
        @NotBlank @Size(min = 6, max = 128) String passwordRepeat
    ) {
    }

    public record LoginRequest(
        @NotBlank String inviteToken,
        @NotBlank @Size(min = 1, max = 50) String login,
        @NotBlank @Size(min = 6, max = 128) String password
    ) {
    }

    public record UserResponse(
        UUID id,
        String login,
        String nickname,
        String status,
        Instant avatarUpdatedAt
    ) {
    }

    public record UpdateProfileRequest(
        String nickname,
        String status
    ) {
    }

    public record RegisterResponse(UserResponse user) {
    }

    public record AuthResponse(String accessToken, UserResponse user) {
    }
}
