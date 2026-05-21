package dev.shlyapcord.service;

import dev.shlyapcord.dto.SettingsDtos.SettingsResponse;
import dev.shlyapcord.dto.SettingsDtos.UpdateSettingsRequest;
import dev.shlyapcord.dto.SettingsDtos.VoiceVolumeResponse;
import dev.shlyapcord.entity.UserAccount;
import dev.shlyapcord.entity.UserSettings;
import dev.shlyapcord.entity.UserVoiceVolume;
import dev.shlyapcord.entity.UserVoiceVolumeId;
import dev.shlyapcord.repository.UserAccountRepository;
import dev.shlyapcord.repository.UserSettingsRepository;
import dev.shlyapcord.repository.UserVoiceVolumeRepository;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class SettingsService {
    private static final int DEFAULT_UI_SOUND_VOLUME = 200;
    private static final String DEFAULT_NOISE_MODE = "rnnoise";

    private final UserAccountRepository userAccountRepository;
    private final UserSettingsRepository userSettingsRepository;
    private final UserVoiceVolumeRepository userVoiceVolumeRepository;

    @Transactional
    public SettingsResponse getSettings(UserAccount user) {
        UserSettings settings = getOrCreateSettings(user);
        return toResponse(settings);
    }

    @Transactional
    public SettingsResponse updateSettings(UserAccount user, UpdateSettingsRequest request) {
        UserSettings settings = getOrCreateSettings(user);
        settings.setUiSoundVolume(clamp(request.uiSoundVolume() == null ? DEFAULT_UI_SOUND_VOLUME : request.uiSoundVolume(), 0, 400));
        settings.setNoiseMode(normalizeNoiseMode(request.noiseMode()));
        settings.setUpdatedAt(Instant.now());
        userSettingsRepository.save(settings);
        return toResponse(settings);
    }

    @Transactional
    public VoiceVolumeResponse getVoiceVolumes(UserAccount owner) {
        Map<String, Integer> volumes = new LinkedHashMap<>();
        for (UserVoiceVolume volume : userVoiceVolumeRepository.findAllByIdOwnerUserId(owner.getId())) {
            volumes.put(volume.getId().getTargetUserId().toString(), volume.getVolumePercent());
        }
        return new VoiceVolumeResponse(volumes);
    }

    @Transactional
    public VoiceVolumeResponse updateVoiceVolume(UserAccount owner, UUID targetUserId, int volumePercent) {
        if (owner.getId().equals(targetUserId)) {
            throw new AuthException(HttpStatus.BAD_REQUEST, "Cannot set volume for yourself");
        }
        UserAccount target = userAccountRepository.findById(targetUserId)
            .filter(user -> !user.isDisabled())
            .orElseThrow(() -> new AuthException(HttpStatus.NOT_FOUND, "Target user not found"));

        UserVoiceVolumeId id = new UserVoiceVolumeId(owner.getId(), target.getId());
        UserVoiceVolume volume = userVoiceVolumeRepository.findById(id).orElseGet(() -> {
            UserVoiceVolume created = new UserVoiceVolume();
            created.setId(id);
            return created;
        });
        volume.setVolumePercent(clamp(volumePercent, 0, 1000));
        volume.setUpdatedAt(Instant.now());
        userVoiceVolumeRepository.save(volume);
        return getVoiceVolumes(owner);
    }

    @Transactional
    public void deleteVoiceVolume(UserAccount owner, UUID targetUserId) {
        userVoiceVolumeRepository.deleteById(new UserVoiceVolumeId(owner.getId(), targetUserId));
    }

    private UserSettings getOrCreateSettings(UserAccount user) {
        return userSettingsRepository.findById(user.getId()).orElseGet(() -> {
            UserSettings settings = new UserSettings();
            settings.setUserId(user.getId());
            settings.setUiSoundVolume(DEFAULT_UI_SOUND_VOLUME);
            settings.setNoiseMode(DEFAULT_NOISE_MODE);
            settings.setUpdatedAt(Instant.now());
            return userSettingsRepository.save(settings);
        });
    }

    private SettingsResponse toResponse(UserSettings settings) {
        return new SettingsResponse(settings.getUiSoundVolume(), settings.getNoiseMode());
    }

    private String normalizeNoiseMode(String noiseMode) {
        String normalized = noiseMode == null ? DEFAULT_NOISE_MODE : noiseMode.trim().toLowerCase(Locale.ROOT);
        if (!"rnnoise".equals(normalized) && !"browser".equals(normalized)) {
            throw new AuthException(HttpStatus.BAD_REQUEST, "Unsupported noise mode");
        }
        return normalized;
    }

    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
