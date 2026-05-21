package dev.shlyapcord.controller;

import dev.shlyapcord.dto.AuthDtos.UpdateProfileRequest;
import dev.shlyapcord.dto.AuthDtos.UserResponse;
import dev.shlyapcord.entity.UserAccount;
import dev.shlyapcord.service.AuthService;
import dev.shlyapcord.service.ProfileService;
import dev.shlyapcord.websocket.SignalingWebSocketHandler;
import jakarta.validation.Valid;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/me")
@RequiredArgsConstructor
public class ProfileController {
    private final AuthService authService;
    private final ProfileService profileService;
    private final SignalingWebSocketHandler signalingWebSocketHandler;

    @GetMapping
    public UserResponse me(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
        return profileService.toResponse(currentUser(authorization));
    }

    @PatchMapping("/profile")
    public UserResponse updateProfile(
        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
        @Valid @RequestBody UpdateProfileRequest request
    ) throws IOException {
        UserAccount user = profileService.updateProfile(currentUser(authorization), request);
        signalingWebSocketHandler.broadcastUserUpdated(user);
        return profileService.toResponse(user);
    }

    private UserAccount currentUser(String authorization) {
        return authService.authenticateAuthorizationHeader(authorization);
    }
}
