package dev.shlyapcord.service;

import dev.shlyapcord.config.AppProperties;
import dev.shlyapcord.entity.UserAccount;
import dev.shlyapcord.entity.UserAvatar;
import dev.shlyapcord.repository.UserAccountRepository;
import dev.shlyapcord.repository.UserAvatarRepository;
import jakarta.transaction.Transactional;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
@RequiredArgsConstructor
public class AvatarService {
    private static final List<String> ALLOWED_CONTENT_TYPES = List.of(
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif"
    );

    private final AppProperties appProperties;
    private final UserAccountRepository userAccountRepository;
    private final UserAvatarRepository userAvatarRepository;

    public Optional<UserAvatar> find(UUID userId) {
        return userAvatarRepository.findById(userId);
    }

    @Transactional
    public UserAvatar upload(UserAccount currentUser, MultipartFile file, AvatarCrop crop) {
        validateInput(file);
        Path tempDir = null;
        try {
            tempDir = Files.createTempDirectory("shlyapcord-avatar-");
            String inputSuffix = suffixFor(file.getContentType());
            Path input = tempDir.resolve("input" + inputSuffix);
            Path output = tempDir.resolve("avatar.webp");
            file.transferTo(input);
            process(input, output, crop);

            byte[] data = Files.readAllBytes(output);
            if (data.length > appProperties.getAvatar().getMaxStoredBytes()) {
                throw new AuthException(HttpStatus.BAD_REQUEST, "Processed avatar is too large");
            }

            Instant now = Instant.now();
            UserAvatar avatar = userAvatarRepository.findById(currentUser.getId()).orElseGet(UserAvatar::new);
            avatar.setUserId(currentUser.getId());
            avatar.setContentType("image/webp");
            avatar.setData(data);
            avatar.setSizeBytes(data.length);
            avatar.setAnimated("image/gif".equalsIgnoreCase(file.getContentType()) || "image/webp".equalsIgnoreCase(file.getContentType()));
            if (avatar.getCreatedAt() == null) {
                avatar.setCreatedAt(now);
            }
            avatar.setUpdatedAt(now);
            UserAvatar saved = userAvatarRepository.save(avatar);

            UserAccount managedUser = userAccountRepository.findById(currentUser.getId())
                .orElseThrow(() -> new AuthException(HttpStatus.UNAUTHORIZED, "Invalid user"));
            managedUser.setAvatarUpdatedAt(now);
            managedUser.setUpdatedAt(now);
            userAccountRepository.save(managedUser);
            return saved;
        } catch (AuthException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new AuthException(HttpStatus.BAD_REQUEST, "Failed to process avatar");
        } finally {
            cleanup(tempDir);
        }
    }

    @Transactional
    public void delete(UserAccount currentUser) {
        userAvatarRepository.deleteById(currentUser.getId());
        UserAccount managedUser = userAccountRepository.findById(currentUser.getId())
            .orElseThrow(() -> new AuthException(HttpStatus.UNAUTHORIZED, "Invalid user"));
        Instant now = Instant.now();
        managedUser.setAvatarUpdatedAt(null);
        managedUser.setUpdatedAt(now);
        userAccountRepository.save(managedUser);
    }

    private void validateInput(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new AuthException(HttpStatus.BAD_REQUEST, "Avatar file is required");
        }
        if (file.getSize() > appProperties.getAvatar().getMaxUploadBytes()) {
            throw new AuthException(HttpStatus.BAD_REQUEST, "Avatar upload is too large");
        }
        String contentType = file.getContentType();
        if (contentType == null || !ALLOWED_CONTENT_TYPES.contains(contentType.toLowerCase())) {
            throw new AuthException(HttpStatus.BAD_REQUEST, "Unsupported avatar format");
        }
    }

    private void process(Path input, Path output, AvatarCrop crop) throws IOException, InterruptedException {
        int size = appProperties.getAvatar().getSize();
        List<String> command = new java.util.ArrayList<>();
        command.add(appProperties.getAvatar().getImageMagickCommand());
        command.add(input.toAbsolutePath().toString());
        command.add("-auto-orient");
        command.add("-coalesce");
        if (crop != null) {
            command.add("-crop");
            command.add(crop.size() + "x" + crop.size() + "+" + crop.x() + "+" + crop.y());
            command.add("+repage");
        }
        command.add("-resize");
        command.add(size + "x" + size + "^");
        command.add("-gravity");
        command.add("center");
        command.add("-extent");
        command.add(size + "x" + size);
        command.add("-layers");
        command.add("optimize");
        command.add(output.toAbsolutePath().toString());

        Process process = new ProcessBuilder(command)
            .redirectErrorStream(true)
            .start();
        boolean completed = process.waitFor(appProperties.getAvatar().getTimeoutSeconds(), TimeUnit.SECONDS);
        if (!completed) {
            process.destroyForcibly();
            throw new AuthException(HttpStatus.BAD_REQUEST, "Avatar processing timed out");
        }
        if (process.exitValue() != 0 || !Files.exists(output)) {
            throw new AuthException(HttpStatus.BAD_REQUEST, "Avatar processing failed");
        }
    }

    public record AvatarCrop(int x, int y, int size) {
        public AvatarCrop {
            if (x < 0 || y < 0 || size <= 0) {
                throw new AuthException(HttpStatus.BAD_REQUEST, "Invalid avatar crop");
            }
        }
    }

    private String suffixFor(String contentType) {
        return switch (contentType == null ? "" : contentType.toLowerCase()) {
            case "image/jpeg" -> ".jpg";
            case "image/png" -> ".png";
            case "image/webp" -> ".webp";
            case "image/gif" -> ".gif";
            default -> ".img";
        };
    }

    private void cleanup(Path tempDir) {
        if (tempDir == null) {
            return;
        }
        try (var paths = Files.walk(tempDir)) {
            paths.sorted((left, right) -> right.compareTo(left)).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ignored) {
                    // Temporary avatar files are best-effort cleanup.
                }
            });
        } catch (IOException ignored) {
            // Temporary avatar files are best-effort cleanup.
        }
    }
}
