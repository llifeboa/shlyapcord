package dev.shlyapcord.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.io.Serializable;
import java.util.UUID;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@Embeddable
@NoArgsConstructor
@EqualsAndHashCode
public class UserVoiceVolumeId implements Serializable {
    @Column(name = "owner_user_id")
    private UUID ownerUserId;

    @Column(name = "target_user_id")
    private UUID targetUserId;

    public UserVoiceVolumeId(UUID ownerUserId, UUID targetUserId) {
        this.ownerUserId = ownerUserId;
        this.targetUserId = targetUserId;
    }
}
