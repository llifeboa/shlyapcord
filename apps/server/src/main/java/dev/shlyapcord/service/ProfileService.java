package dev.shlyapcord.service;

import dev.shlyapcord.dto.AuthDtos.UpdateProfileRequest;
import dev.shlyapcord.dto.AuthDtos.UserResponse;
import dev.shlyapcord.entity.UserAccount;
import dev.shlyapcord.repository.UserAccountRepository;
import jakarta.transaction.Transactional;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class ProfileService {
    private final UserAccountRepository userAccountRepository;

    @Transactional
    public UserAccount updateProfile(UserAccount currentUser, UpdateProfileRequest request) {
        UserAccount user = userAccountRepository.findById(currentUser.getId())
            .orElseThrow(() -> new AuthException(HttpStatus.UNAUTHORIZED, "Invalid user"));
        String nickname = normalizeNickname(request.nickname(), user.getLogin());
        user.setNickname(nickname);
        user.setStatus(normalizeStatus(request.status()));
        user.setUpdatedAt(Instant.now());
        return userAccountRepository.save(user);
    }

    public UserResponse toResponse(UserAccount user) {
        return new UserResponse(user.getId(), user.getLogin(), user.getNickname(), user.getStatus(), user.getAvatarUpdatedAt());
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

    private String normalizeStatus(String rawStatus) {
        String status = rawStatus == null ? "" : rawStatus.trim();
        if (status.length() > 50) {
            throw new AuthException(HttpStatus.BAD_REQUEST, "Status must be 0-50 characters");
        }
        return status;
    }
}
