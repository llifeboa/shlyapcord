package dev.shlyapcord.repository;

import dev.shlyapcord.entity.UserAvatar;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserAvatarRepository extends JpaRepository<UserAvatar, UUID> {
}
