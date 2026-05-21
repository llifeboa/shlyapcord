package dev.shlyapcord.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import java.util.Map;

public final class SettingsDtos {
    private SettingsDtos() {
    }

    public record SettingsResponse(
        int uiSoundVolume,
        String noiseMode
    ) {
    }

    public record UpdateSettingsRequest(
        @Min(0) @Max(400) Integer uiSoundVolume,
        @NotBlank String noiseMode
    ) {
    }

    public record VoiceVolumeResponse(
        Map<String, Integer> volumes
    ) {
    }

    public record UpdateVoiceVolumeRequest(
        @Min(0) @Max(1000) int volumePercent
    ) {
    }
}
