package dev.shlyapcord.entity;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "user_voice_volumes")
public class UserVoiceVolume {
    @EmbeddedId
    private UserVoiceVolumeId id;

    @Column(name = "volume_percent", nullable = false)
    private int volumePercent;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
