package dev.shlyapcord.controller;

import dev.shlyapcord.dto.SettingsDtos.SettingsResponse;
import dev.shlyapcord.dto.SettingsDtos.UpdateSettingsRequest;
import dev.shlyapcord.dto.SettingsDtos.UpdateVoiceVolumeRequest;
import dev.shlyapcord.dto.SettingsDtos.VoiceVolumeResponse;
import dev.shlyapcord.entity.UserAccount;
import dev.shlyapcord.service.AuthService;
import dev.shlyapcord.service.SettingsService;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/settings")
@RequiredArgsConstructor
public class SettingsController {
    private final AuthService authService;
    private final SettingsService settingsService;

    @GetMapping
    public SettingsResponse getSettings(
        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization
    ) {
        return settingsService.getSettings(currentUser(authorization));
    }

    @PutMapping
    public SettingsResponse updateSettings(
        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
        @Valid @RequestBody UpdateSettingsRequest request
    ) {
        return settingsService.updateSettings(currentUser(authorization), request);
    }

    @GetMapping("/voice-volumes")
    public VoiceVolumeResponse getVoiceVolumes(
        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization
    ) {
        return settingsService.getVoiceVolumes(currentUser(authorization));
    }

    @PutMapping("/voice-volumes/{targetUserId}")
    public VoiceVolumeResponse updateVoiceVolume(
        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
        @PathVariable UUID targetUserId,
        @Valid @RequestBody UpdateVoiceVolumeRequest request
    ) {
        return settingsService.updateVoiceVolume(currentUser(authorization), targetUserId, request.volumePercent());
    }

    @DeleteMapping("/voice-volumes/{targetUserId}")
    public ResponseEntity<Void> deleteVoiceVolume(
        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
        @PathVariable UUID targetUserId
    ) {
        settingsService.deleteVoiceVolume(currentUser(authorization), targetUserId);
        return ResponseEntity.noContent().build();
    }

    private UserAccount currentUser(String authorization) {
        return authService.authenticateAuthorizationHeader(authorization);
    }
}
