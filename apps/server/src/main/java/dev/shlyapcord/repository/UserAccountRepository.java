package dev.shlyapcord.repository;

import dev.shlyapcord.entity.UserAccount;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserAccountRepository extends JpaRepository<UserAccount, UUID> {
    boolean existsByLogin(String login);

    Optional<UserAccount> findByLogin(String login);

    List<UserAccount> findAllByDisabledFalseOrderByNicknameAsc();
}
