package dev.shlyapcord.controller;

import dev.shlyapcord.dto.AuthDtos.UserResponse;
import dev.shlyapcord.entity.UserAccount;
import dev.shlyapcord.entity.UserAvatar;
import dev.shlyapcord.service.AuthService;
import dev.shlyapcord.service.AvatarService.AvatarCrop;
import dev.shlyapcord.service.AvatarService;
import dev.shlyapcord.service.ProfileService;
import dev.shlyapcord.websocket.SignalingWebSocketHandler;
import java.io.IOException;
import java.time.Duration;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequiredArgsConstructor
public class AvatarController {
    private final AuthService authService;
    private final AvatarService avatarService;
    private final ProfileService profileService;
    private final SignalingWebSocketHandler signalingWebSocketHandler;

    @GetMapping("/api/users/{userId}/avatar")
    public ResponseEntity<byte[]> getAvatar(@PathVariable UUID userId) {
        return avatarService.find(userId)
            .map(this::avatarResponse)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping(value = "/api/me/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public UserResponse uploadAvatar(
        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
        @RequestPart("file") MultipartFile file,
        @RequestParam(value = "cropX", required = false) Integer cropX,
        @RequestParam(value = "cropY", required = false) Integer cropY,
        @RequestParam(value = "cropSize", required = false) Integer cropSize
    ) throws IOException {
        UserAccount currentUser = currentUser(authorization);
        avatarService.upload(currentUser, file, crop(cropX, cropY, cropSize));
        UserAccount updatedUser = authService.reloadUser(currentUser);
        signalingWebSocketHandler.broadcastUserUpdated(updatedUser);
        return profileService.toResponse(updatedUser);
    }

    @DeleteMapping("/api/me/avatar")
    public UserResponse deleteAvatar(
        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization
    ) throws IOException {
        UserAccount currentUser = currentUser(authorization);
        avatarService.delete(currentUser);
        UserAccount updatedUser = authService.reloadUser(currentUser);
        signalingWebSocketHandler.broadcastUserUpdated(updatedUser);
        return profileService.toResponse(updatedUser);
    }

    private ResponseEntity<byte[]> avatarResponse(UserAvatar avatar) {
        return ResponseEntity.ok()
            .cacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable())
            .contentType(MediaType.parseMediaType(avatar.getContentType()))
            .body(avatar.getData());
    }

    private UserAccount currentUser(String authorization) {
        return authService.authenticateAuthorizationHeader(authorization);
    }

    private AvatarCrop crop(Integer cropX, Integer cropY, Integer cropSize) {
        if (cropX == null && cropY == null && cropSize == null) {
            return null;
        }
        if (cropX == null || cropY == null || cropSize == null) {
            throw new dev.shlyapcord.service.AuthException(org.springframework.http.HttpStatus.BAD_REQUEST, "Invalid avatar crop");
        }
        return new AvatarCrop(cropX, cropY, cropSize);
    }
}
