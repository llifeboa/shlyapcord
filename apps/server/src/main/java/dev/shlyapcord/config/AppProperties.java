package dev.shlyapcord.config;

import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter
@Setter
@ConfigurationProperties(prefix = "shlyapcord")
public class AppProperties {
    private List<String> invites = new ArrayList<>();
    private List<String> corsOrigins = new ArrayList<>(List.of("*"));
    private Ice ice = new Ice();
    private Auth auth = new Auth();
    private Avatar avatar = new Avatar();

    @Getter
    @Setter
    public static class Ice {
        private String stunUrl;
        private String turnUrl;
        private String turnUsername;
        private String turnCredential;
    }

    @Getter
    @Setter
    public static class Auth {
        private String jwtPrivateKey;
        private String jwtPublicKey;
        private String refreshHmacSecret = "local-dev-refresh-hmac-secret-change-me";
        private boolean refreshCookieSecure = true;
    }

    @Getter
    @Setter
    public static class Avatar {
        private String imageMagickCommand = "convert";
        private long maxUploadBytes = 10L * 1024 * 1024;
        private long maxStoredBytes = 5L * 1024 * 1024;
        private int size = 256;
        private int timeoutSeconds = 15;
    }
}
