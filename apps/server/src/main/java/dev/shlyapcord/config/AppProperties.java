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

    @Getter
    @Setter
    public static class Ice {
        private String stunUrl;
        private String turnUrl;
        private String turnUsername;
        private String turnCredential;
    }
}
