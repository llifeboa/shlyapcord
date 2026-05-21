package dev.shlyapcord.repository;

import dev.shlyapcord.entity.RefreshToken;
import dev.shlyapcord.entity.UserAccount;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {
    Optional<RefreshToken> findByTokenHash(String tokenHash);

    List<RefreshToken> findAllByUserAndRevokedAtIsNull(UserAccount user);

    Optional<RefreshToken> findBySessionIdAndRevokedAtIsNull(UUID sessionId);
}
