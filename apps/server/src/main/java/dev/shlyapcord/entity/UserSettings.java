package dev.shlyapcord.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "user_settings")
public class UserSettings {
    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "ui_sound_volume", nullable = false)
    private int uiSoundVolume = 200;

    @Column(name = "noise_mode", nullable = false)
    private String noiseMode = "rnnoise";

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
