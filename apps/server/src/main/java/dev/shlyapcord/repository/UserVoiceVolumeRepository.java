package dev.shlyapcord.repository;

import dev.shlyapcord.entity.UserVoiceVolume;
import dev.shlyapcord.entity.UserVoiceVolumeId;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserVoiceVolumeRepository extends JpaRepository<UserVoiceVolume, UserVoiceVolumeId> {
    List<UserVoiceVolume> findAllByIdOwnerUserId(UUID ownerUserId);
}
